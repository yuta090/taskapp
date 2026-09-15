import { after, NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { mfaGuardResponse } from '@/lib/auth/apiMfaGuard'
import { createAuditLog, generateAuditSummary } from '@/lib/audit'
import { rpc } from '@/lib/supabase/rpc'
import { resolveReturnAssignee } from '../resolveReturnAssignee'
import { reviewGateErrorMessage } from '@/lib/tasks/reviewGateErrorMessage'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * Server-side notification. Uses X-Internal-Secret header for authentication
 * (no user session needed). Returns a promise so callers can hand it to
 * `after()` and keep the function alive until the request actually settles
 * (a plain un-awaited fetch can be cut off once the response is sent).
 */
function fireServerNotification(
  request: NextRequest,
  params: {
    event: string
    taskId: string
    spaceId: string
    actorId: string
    changes?: Record<string, string | undefined>
  },
): Promise<void> {
  const secret = process.env.INTERNAL_NOTIFY_SECRET
  if (!secret) return Promise.resolve()

  const origin = request.nextUrl.origin
  return fetch(`${origin}/api/slack/notify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-secret': secret,
    },
    body: JSON.stringify(params),
  }).then(
    () => undefined,
    (err) => {
      console.warn('[portal-notify] Failed:', err)
    }
  )
}

/**
 * Creates an in-app inbox notification for whoever created the task, so a
 * client's approval/change-request is visible in the internal Inbox and not
 * only as a (frequently missed) Slack message. Never notifies the actor
 * themselves (e.g. if created_by happens to equal the acting client).
 */
async function notifyTaskCreator(
  supabase: SupabaseClient<Database>,
  params: {
    orgId: string
    spaceId: string
    createdBy: string | null
    actorId: string
    taskId: string
    taskTitle: string
    type: 'task_completed' | 'ball_passed'
    dedupeSuffix: string
    title: string
    message: string
  },
): Promise<void> {
  if (!params.createdBy || params.createdBy === params.actorId) return

  try {
    await rpc.createTaskNotification(supabase, {
      orgId: params.orgId,
      spaceId: params.spaceId,
      toUserId: params.createdBy,
      type: params.type,
      dedupeKey: `portal_${params.dedupeSuffix}:${params.taskId}:${params.createdBy}`,
      payload: {
        task_id: params.taskId,
        task_title: params.taskTitle,
        title: params.title,
        message: params.message,
      },
    })
  } catch (err) {
    console.error('[portal-notify] Failed to create in-app notification:', err)
  }
}

/**
 * request_changes 専用: task_comments の insert トリガー（task_comments_notify,
 * supabase/migrations/20260915105122_task_comment_notify.sql）は、作成者が担当者・
 * 社内承認の承認者・過去の書き手のいずれかに該当するとき、その人あてに
 * 'comment_added' の受信トレイ通知（dedupe_key = 'task_comment:<comment.id>'）を
 * 既に作っている。そこへさらに notifyTaskCreator で 'ball_passed' を作ると、
 * 作成者が担当者と同じ人だった場合に同じ用件の通知が2通（プッシュも2回）届く。
 *
 * 'ball_passed' は「相手が待っている」種類ですぐメールが届き受信トレイで要対応に
 * なる一方、'comment_added' はプッシュのみで要対応にならない（src/lib/notifications/
 * delivery.ts・classify.ts）。作成者あての通知は 'ball_passed' の1通に揃えたいので、
 * トリガーが作った行が見つかればそれを書き換え、無ければ従来どおり notifyTaskCreator
 * で新規に作る。プッシュは insert のときにトリガーから1回だけ送る（update では送らない）。
 * 送る側（src/app/api/push/dispatch/route.ts）は送る時点で行を読み直すので、プッシュの
 * 文面が「コメントが付きました」「修正依頼」のどちらになるかは書き換えとの前後で変わる
 * （回数は1回）。即時メールは5分ごとのワーカーが type を見て送るため、書き換えたあとの
 * type='ball_passed' で ball_passed として届く。
 *
 * 探す・書き換えるのに失敗しても、修正依頼そのものは既に成功しているので、
 * notifyTaskCreator と同じくログに残すだけで依頼の成功レスポンスは変えない。
 */
async function upgradeOrNotifyTaskCreatorForChangeRequest(
  admin: SupabaseClient<Database>,
  params: {
    orgId: string
    spaceId: string
    createdBy: string | null
    actorId: string
    taskId: string
    taskTitle: string
    commentId: string | null
    comment: string
  },
): Promise<void> {
  const { createdBy, actorId, commentId, taskId, taskTitle, comment } = params
  if (!createdBy || createdBy === actorId) return

  const title = `「${taskTitle}」に修正依頼が届きました`

  if (commentId) {
    // notifications の型定義（src/types/database.ts）が actioned_at 列を含まず
    // 本番の実列と食い違っている（既知のドリフト）ため、この表への読み書きだけは
    // 緩い型のクライアントで行う（他の呼び出し箇所の (admin as SupabaseClient) と同じやり方）。
    let existingId: string | null = null
    try {
      const { data: existing, error: findError } = await (admin as unknown as SupabaseClient)
        .from('notifications')
        .select('id')
        .eq('to_user_id', createdBy)
        .eq('channel', 'in_app')
        .eq('dedupe_key', `task_comment:${commentId}`)
        .maybeSingle()

      if (findError) throw findError
      existingId = (existing as { id: string } | null)?.id ?? null
    } catch (err) {
      // 探せなかったときは、作成者に届いているか分からない。修正依頼は相手先が待っている知らせなので、
      // 1通も届かないより2通になるほうを選び、下の notifyTaskCreator で送る
      console.error('[portal-notify] Failed to look up comment notification for task creator:', err)
    }

    if (existingId) {
      try {
        const { error: updateError } = await (admin as unknown as SupabaseClient)
          .from('notifications')
          .update({
            type: 'ball_passed',
            payload: {
              task_id: taskId,
              task_title: taskTitle,
              title,
              message: comment,
              comment_id: commentId,
            },
            read_at: null,
            actioned_at: null,
          })
          .eq('id', existingId)

        if (updateError) throw updateError
      } catch (err) {
        // 書き換えに失敗しても、作成者にはトリガーのコメントの通知がもう届いている。二重にしない
        console.error('[portal-notify] Failed to upgrade comment notification to ball_passed:', err)
      }
      return
    }
  }

  await notifyTaskCreator(admin, {
    orgId: params.orgId,
    spaceId: params.spaceId,
    createdBy,
    actorId,
    taskId,
    taskTitle,
    type: 'ball_passed',
    dedupeSuffix: 'changes_requested',
    title,
    message: comment,
  })
}

interface TaskActionBody {
  action: 'approve' | 'request_changes' | 'estimate_approve' | 'estimate_reject'
  comment?: string
}

// Maximum comment length
const MAX_COMMENT_LENGTH = 2000

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params

  try {
    const supabase = await createClient()

    // Verify user is authenticated
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 })
    }
    // 二要素認証: 登録済み × コード未入力(aal1) は service role で触る前に弾く（RLS 経由でない経路の防衛）
    const mfaBlock = await mfaGuardResponse(supabase as SupabaseClient, user)
    if (mfaBlock) return mfaBlock

    // Parse request body
    const body: TaskActionBody = await request.json()
    const { action, comment } = body

    if (!action || !['approve', 'request_changes', 'estimate_approve', 'estimate_reject'].includes(action)) {
      return NextResponse.json(
        { error: '無効なアクションです' },
        { status: 400 }
      )
    }

    // Server-side validation: request_changes and estimate_reject require a comment
    if (action === 'request_changes' || action === 'estimate_reject') {
      if (!comment || comment.trim().length === 0) {
        return NextResponse.json(
          { error: '修正依頼にはコメントが必要です' },
          { status: 400 }
        )
      }
      if (comment.length > MAX_COMMENT_LENGTH) {
        return NextResponse.json(
          { error: `コメントは${MAX_COMMENT_LENGTH}文字以内にしてください` },
          { status: 400 }
        )
      }
    }

    // Validate comment length for approve action too (if provided)
    if (comment && comment.length > MAX_COMMENT_LENGTH) {
      return NextResponse.json(
        { error: `コメントは${MAX_COMMENT_LENGTH}文字以内にしてください` },
        { status: 400 }
      )
    }

    // Fetch task details and verify membership in parallel
     
    const taskPromise = (supabase as SupabaseClient)
      .from('tasks')
      .select('id, org_id, space_id, title, status, ball, type, estimated_cost, estimate_status, created_by, assignee_id')
      .eq('id', taskId)
      .single()

    const { data: task, error: taskError } = await taskPromise

    if (taskError || !task) {
      return NextResponse.json(
        { error: 'タスクが見つかりません' },
        { status: 404 }
      )
    }

    // Server-side validation: task must be in client's court
    if (task.ball !== 'client') {
      return NextResponse.json(
        { error: 'このタスクは現在クライアントの対応待ちではありません' },
        { status: 409 }
      )
    }

    // Server-side validation: task must not already be done
    if (task.status === 'done') {
      return NextResponse.json(
        { error: 'このタスクは既に完了しています' },
        { status: 409 }
      )
    }

    // Verify user has access to this task's space (is a client member)
     
    const { data: membership } = await (supabase as SupabaseClient)
      .from('space_memberships')
      .select('id, role')
      .eq('space_id', task.space_id)
      .eq('user_id', user.id)
      .eq('role', 'client')
      .single()

    if (!membership) {
      return NextResponse.json(
        { error: 'アクセス権限がありません' },
        { status: 403 }
      )
    }

    // Validate estimate actions: task must have pending estimate
    if ((action === 'estimate_approve' || action === 'estimate_reject') && task.estimate_status !== 'pending') {
      return NextResponse.json(
        { error: '見積もりが確認待ち状態ではありません' },
        { status: 409 }
      )
    }

    // Block regular approve/request_changes when estimate is pending
    // Client must use estimate_approve/estimate_reject instead
    if ((action === 'approve' || action === 'request_changes') && task.estimate_status === 'pending') {
      return NextResponse.json(
        { error: '見積もりの確認が必要です。見積もりを承認または再見積もり依頼してください。', reason: 'blocked' },
        { status: 409 }
      )
    }

    // 確認（ログイン・タスクの読み取り・membership・区分）が全て終わったあとで、
    // 実際の書き込みに使うサーバー側(service role)クライアントを作る。書き込む
    // 行は確認済みの id・space_id・ball・client_scope の条件で固定する。
    const admin = createAdminClient()

    const now = new Date().toISOString()
    // Safe trimmed comment for use in request_changes branch
    const trimmedComment = comment?.trim() || ''

    if (action === 'estimate_approve') {
      // Approve estimate: set estimate_status to approved, ball to internal
      const { data: updatedTask, error: updateError } = await (admin as SupabaseClient)
        .from('tasks')
        .update({
          estimate_status: 'approved',
          ball: 'internal',
          updated_at: now,
        })
        .eq('id', taskId)
        .eq('space_id', task.space_id)
        .eq('ball', 'client')
        .eq('client_scope', 'deliverable')
        .eq('estimate_status', 'pending')
        .select('id')
        .single()

      if (updateError || !updatedTask) {
        return NextResponse.json(
          { error: 'タスクの状態が変更されました。ページを再読み込みしてください。' },
          { status: 409 }
        )
      }

      after(() =>
        createAuditLog({
          supabase,
          orgId: task.org_id,
          spaceId: task.space_id,
          actorId: user.id,
          actorRole: 'client',
          eventType: 'estimate.approved',
          targetType: 'task',
          targetId: taskId,
          summary: generateAuditSummary('estimate.approved', { title: task.title }),
          dataBefore: { estimate_status: 'pending' },
          dataAfter: { estimate_status: 'approved' },
          metadata: { estimated_cost: task.estimated_cost, comment: trimmedComment || null },
          visibility: 'client',
        }).catch(err => console.error('Audit log failed (estimate_approve):', err))
      )

      after(() =>
        fireServerNotification(request, {
          event: 'estimate_approved',
          taskId,
          spaceId: task.space_id,
          actorId: user.id,
          changes: { estimatedCost: String(task.estimated_cost) },
        })
      )

      return NextResponse.json({
        success: true,
        message: '見積もりを承認しました',
        taskId,
      })
    }

    if (action === 'estimate_reject') {
      // Reject estimate: set estimate_status to rejected, ball to internal
      const { data: updatedTask, error: updateError } = await (admin as SupabaseClient)
        .from('tasks')
        .update({
          estimate_status: 'rejected',
          ball: 'internal',
          updated_at: now,
        })
        .eq('id', taskId)
        .eq('space_id', task.space_id)
        .eq('ball', 'client')
        .eq('client_scope', 'deliverable')
        .eq('estimate_status', 'pending')
        .select('id')
        .single()

      if (updateError || !updatedTask) {
        return NextResponse.json(
          { error: 'タスクの状態が変更されました。ページを再読み込みしてください。' },
          { status: 409 }
        )
      }

      // Insert comment — required before the audit log/notification below,
      // since a failed insert reverts the estimate status and must not leave
      // a "rejected" audit trail or notification behind.
      const { error: commentError } = await (admin as SupabaseClient)
        .from('task_comments')
        .insert({
          org_id: task.org_id,
          space_id: task.space_id,
          task_id: taskId,
          actor_id: user.id,
          body: trimmedComment,
          visibility: 'client',
          created_at: now,
          updated_at: now,
        })

      if (commentError) {
        console.error('Failed to create estimate reject comment:', commentError)
        // Attempt to revert estimate status (conditional to avoid clobbering newer state)
        await (admin as SupabaseClient)
          .from('tasks')
          .update({ estimate_status: 'pending', ball: 'client', updated_at: now })
          .eq('id', taskId)
          .eq('space_id', task.space_id)
          .eq('estimate_status', 'rejected')
          .eq('updated_at', now)

        return NextResponse.json(
          { error: 'コメントの保存に失敗しました。もう一度お試しください。' },
          { status: 500 }
        )
      }

      // Audit log and Slack notification must still run after the response is
      // sent, so they are handed to after(). Registered only once the comment
      // insert has actually succeeded, so a failed/reverted request never
      // leaves a "rejected" trail behind.
      after(() =>
        createAuditLog({
          supabase,
          orgId: task.org_id,
          spaceId: task.space_id,
          actorId: user.id,
          actorRole: 'client',
          eventType: 'estimate.rejected',
          targetType: 'task',
          targetId: taskId,
          summary: generateAuditSummary('estimate.rejected', { title: task.title }),
          dataBefore: { estimate_status: 'pending' },
          dataAfter: { estimate_status: 'rejected' },
          metadata: { estimated_cost: task.estimated_cost, comment: trimmedComment },
          visibility: 'client',
        }).catch(err => console.error('Audit log failed (estimate_reject):', err))
      )

      after(() =>
        fireServerNotification(request, {
          event: 'estimate_rejected',
          taskId,
          spaceId: task.space_id,
          actorId: user.id,
          changes: { estimatedCost: String(task.estimated_cost) },
        })
      )

      return NextResponse.json({
        success: true,
        message: '再見積もりを依頼しました',
        taskId,
      })
    }

    if (action === 'approve') {
      // Update task status to done and transfer ball to internal
      // IMPORTANT: Include ball='client' in WHERE clause to prevent race conditions

      const { data: updatedTask, error: updateError } = await (admin as SupabaseClient)
        .from('tasks')
        .update({
          status: 'done',
          ball: 'internal',
          updated_at: now,
        })
        .eq('id', taskId)
        .eq('space_id', task.space_id)
        .eq('ball', 'client')  // Race condition protection
        .eq('client_scope', 'deliverable')
        .neq('status', 'done') // Don't update already-done tasks
        .select('id')
        .single()

      if (updateError || !updatedTask) {
        // If no row was updated, it means the task state changed (race
        // condition) — OR the enforce_review_gate DB trigger rejected the
        // transition because a named review is still open/blocked, or a
        // spec decision is undecided. Surface the trigger's reason clearly
        // instead of the generic "state changed" message when we recognize it.
        console.error('Error approving task:', updateError || 'No rows updated')
        const gateMessage = reviewGateErrorMessage(updateError)
        return NextResponse.json(
          gateMessage
            ? { error: gateMessage, reason: 'blocked' }
            : { error: 'タスクの状態が変更されました。ページを再読み込みしてください。' },
          { status: 409 }
        )
      }

      // Audit log must still run after the response is sent, so it is handed
      // to after() instead of being fired-and-forgotten.
      after(() =>
        createAuditLog({
          supabase,
          orgId: task.org_id,
          spaceId: task.space_id,
          actorId: user.id,
          actorRole: 'client',
          eventType: 'approval.approved',
          targetType: 'task',
          targetId: taskId,
          summary: generateAuditSummary('approval.approved', { title: task.title }),
          dataBefore: { status: task.status, ball: task.ball },
          dataAfter: { status: 'done', ball: 'internal' },
          metadata: { comment: comment?.trim() || null },
          visibility: 'client',
        }).catch(err => console.error('Audit log failed (approve):', err))
      )

      // Slack notification for status change — same reasoning as the audit log above.
      after(() =>
        fireServerNotification(request, {
          event: 'status_changed',
          taskId,
          spaceId: task.space_id,
          actorId: user.id,
          changes: { oldStatus: task.status, newStatus: 'done' },
        })
      )

      // In-app inbox notification so the approval is visible without Slack
      await notifyTaskCreator(admin as unknown as SupabaseClient<Database>, {
        orgId: task.org_id,
        spaceId: task.space_id,
        createdBy: task.created_by,
        actorId: user.id,
        taskId,
        taskTitle: task.title,
        type: 'task_completed',
        dedupeSuffix: 'approved',
        title: `「${task.title}」が承認されました`,
        message: trimmedComment || 'クライアントがタスクを承認しました。',
      })

      return NextResponse.json({
        success: true,
        message: '承認しました',
        taskId,
      })
    } else {
      // action === 'request_changes'
      // Transfer ball back to internal team, and make sure the task lands on
      // a real internal owner (assignee_id may currently be the client
      // reviewer, or unset) — H-1: previously the task effectively lost its
      // owner on the way back in.
      const returnAssigneeId = await resolveReturnAssignee(supabase as SupabaseClient, {
        spaceId: task.space_id,
        assigneeId: task.assignee_id,
        createdBy: task.created_by,
      })

      // IMPORTANT: Include ball='client' in WHERE clause to prevent race conditions

      const { data: updatedTask, error: updateError } = await (admin as SupabaseClient)
        .from('tasks')
        .update({
          ball: 'internal',
          assignee_id: returnAssigneeId,
          updated_at: now,
        })
        .eq('id', taskId)
        .eq('space_id', task.space_id)
        .eq('ball', 'client')  // Race condition protection
        .eq('client_scope', 'deliverable')
        .neq('status', 'done') // Don't update already-done tasks
        .select('id')
        .single()

      if (updateError || !updatedTask) {
        // If no row was updated, it means the task state changed (race condition)
        console.error('Error requesting changes:', updateError || 'No rows updated')
        return NextResponse.json(
          { error: 'タスクの状態が変更されました。ページを再読み込みしてください。' },
          { status: 409 }
        )
      }

      // Comment is required — insert and await it before the audit log/
      // notification below, since a failed insert reverts the ball/assignee
      // change and must not leave a "changes requested" audit trail or
      // notification behind. Select the id back so we can look up the
      // in-app notification the insert trigger (task_comments_notify) may
      // already have created for the task creator (see upgradeOrNotifyTaskCreator below).
      const { data: insertedComment, error: commentError } = await (admin as SupabaseClient)
        .from('task_comments')
        .insert({
          org_id: task.org_id,
          space_id: task.space_id,
          task_id: taskId,
          actor_id: user.id,
          body: trimmedComment,
          visibility: 'client',
          created_at: now,
          updated_at: now,
        })
        .select('id')
        .single()

      if (commentError) {
        console.error('Failed to create task comment:', commentError)

        // Attempt to revert the ball (and assignee) change (conditional to avoid clobbering newer state)

        await (admin as SupabaseClient)
          .from('tasks')
          .update({ ball: 'client', assignee_id: task.assignee_id, updated_at: now })
          .eq('id', taskId)
          .eq('space_id', task.space_id)
          .eq('ball', 'internal')
          .eq('updated_at', now)

        return NextResponse.json(
          { error: 'コメントの保存に失敗しました。もう一度お試しください。' },
          { status: 500 }
        )
      }

      // Audit log and Slack notification must still run after the response is
      // sent, so they are handed to after(). Registered only once the comment
      // insert has actually succeeded, so a failed/reverted request never
      // leaves a "changes requested" trail behind.
      after(() =>
        createAuditLog({
          supabase,
          orgId: task.org_id,
          spaceId: task.space_id,
          actorId: user.id,
          actorRole: 'client',
          eventType: 'approval.changes_requested',
          targetType: 'task',
          targetId: taskId,
          summary: generateAuditSummary('approval.changes_requested', { title: task.title }),
          dataBefore: { ball: task.ball },
          dataAfter: { ball: 'internal' },
          metadata: { comment: trimmedComment },
          visibility: 'client',
        }).catch(err => console.error('Audit log failed (request_changes):', err))
      )

      // Slack notification for ball passed back to internal — same reasoning as above.
      after(() =>
        fireServerNotification(request, {
          event: 'ball_passed',
          taskId,
          spaceId: task.space_id,
          actorId: user.id,
          changes: { newBall: 'internal' },
        })
      )

      // In-app inbox notification so the change request is visible without Slack.
      // Upgrades the trigger's own comment_added row when there is one, instead
      // of always creating a second ball_passed notification (see function doc).
      await upgradeOrNotifyTaskCreatorForChangeRequest(admin as unknown as SupabaseClient<Database>, {
        orgId: task.org_id,
        spaceId: task.space_id,
        createdBy: task.created_by,
        actorId: user.id,
        taskId,
        taskTitle: task.title,
        commentId: insertedComment?.id ?? null,
        comment: trimmedComment,
      })

      return NextResponse.json({
        success: true,
        message: '修正を依頼しました',
        taskId,
      })
    }
  } catch (error) {
    console.error('Portal task action error:', error)
    return NextResponse.json(
      { error: 'サーバーエラーが発生しました' },
      { status: 500 }
    )
  }
}
