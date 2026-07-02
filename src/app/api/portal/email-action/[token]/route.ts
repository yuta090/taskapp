import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createAuditLog, generateAuditSummary } from '@/lib/audit'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Fire-and-forget Slack notification (server-side, uses internal secret).
 */
function fireSlackNotification(
  origin: string,
  params: {
    event: string
    taskId: string
    spaceId: string
    actorId: string
    changes?: Record<string, string | undefined>
  },
): void {
  const secret = process.env.INTERNAL_NOTIFY_SECRET
  if (!secret) return

  fetch(`${origin}/api/slack/notify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-secret': secret,
    },
    body: JSON.stringify(params),
  }).catch((err) => {
    console.warn('[email-action-notify] Failed:', err)
  })
}

/**
 * GET /api/portal/email-action/[token]
 * トークンを検証し、タスク情報を返す（確認ページ用）
 *
 * POST /api/portal/email-action/[token]
 * 承認アクションを実行する（ワンクリック承認）
 *
 * 認証: トークン自体が認証（ログイン不要）
 */

interface TokenRecord {
  id: string
  token: string
  task_id: string
  space_id: string
  org_id: string
  recipient_user_id: string
  recipient_email: string
  action_type: 'approve' | 'estimate_approve'
  used_at: string | null
  expires_at: string
}

async function validateToken(admin: SupabaseClient, token: string): Promise<{
  tokenRecord: TokenRecord | null
  error: string | null
  status: number
}> {
  const { data, error } = await admin
    .from('email_action_tokens')
    .select('*')
    .eq('token', token)
    .single()

  if (error || !data) {
    return { tokenRecord: null, error: 'トークンが見つかりません', status: 404 }
  }

  const record = data as TokenRecord

  if (record.used_at) {
    return { tokenRecord: null, error: 'このリンクは既に使用されています', status: 410 }
  }

  if (new Date(record.expires_at) < new Date()) {
    return { tokenRecord: null, error: 'このリンクは有効期限が切れています', status: 410 }
  }

  return { tokenRecord: record, error: null, status: 200 }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  try {
    const admin = createAdminClient() as SupabaseClient

    const { tokenRecord, error, status } = await validateToken(admin, token)
    if (!tokenRecord) {
      return NextResponse.json({ error }, { status })
    }

    // タスク情報を取得
    const { data: task } = await admin
      .from('tasks')
      .select('id, title, description, status, ball, estimate_status, estimated_cost')
      .eq('id', tokenRecord.task_id)
      .single()

    if (!task) {
      return NextResponse.json({ error: 'タスクが見つかりません' }, { status: 404 })
    }

    // スペース名・組織名を取得
    const { data: space } = await admin
      .from('spaces')
      .select('name, organizations!inner(name)')
      .eq('id', tokenRecord.space_id)
      .single()

    return NextResponse.json({
      task: {
        id: task.id,
        title: task.title,
        description: task.description,
        status: task.status,
        ball: task.ball,
        estimateStatus: task.estimate_status,
        estimatedCost: task.estimated_cost,
      },
      actionType: tokenRecord.action_type,
      spaceName: (space as Record<string, unknown>)?.name || 'プロジェクト',
      orgName: ((space as Record<string, unknown>)?.organizations as Record<string, unknown>)?.name || '',
      canExecute: task.ball === 'client' && task.status !== 'done',
    })
  } catch (error) {
    console.error('[email-action] GET error:', error)
    return NextResponse.json({ error: 'サーバーエラー' }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  try {
    const admin = createAdminClient() as SupabaseClient

    const { tokenRecord, error, status } = await validateToken(admin, token)
    if (!tokenRecord) {
      return NextResponse.json({ error }, { status })
    }

    // タスク情報を取得
    const { data: task } = await admin
      .from('tasks')
      .select('id, title, org_id, space_id, status, ball, estimate_status, estimated_cost')
      .eq('id', tokenRecord.task_id)
      .single()

    if (!task) {
      return NextResponse.json({ error: 'タスクが見つかりません' }, { status: 404 })
    }

    // タスク状態の検証
    if (task.ball !== 'client') {
      return NextResponse.json(
        { error: 'このタスクは現在クライアントの対応待ちではありません' },
        { status: 409 }
      )
    }

    if (task.status === 'done') {
      return NextResponse.json(
        { error: 'このタスクは既に完了しています' },
        { status: 409 }
      )
    }

    const now = new Date().toISOString()

    if (tokenRecord.action_type === 'estimate_approve') {
      // 見積もり承認
      if (task.estimate_status !== 'pending') {
        return NextResponse.json(
          { error: '見積もりが確認待ち状態ではありません' },
          { status: 409 }
        )
      }

      const { data: updated, error: updateError } = await admin
        .from('tasks')
        .update({
          estimate_status: 'approved',
          ball: 'internal',
          updated_at: now,
        })
        .eq('id', task.id)
        .eq('ball', 'client')
        .eq('estimate_status', 'pending')
        .neq('status', 'done')
        .select('id')
        .maybeSingle()

      if (updateError) {
        console.error('[email-action] estimate_approve update failed:', updateError)
        return NextResponse.json({ error: 'サーバーエラー' }, { status: 500 })
      }
      if (!updated) {
        return NextResponse.json(
          { error: 'タスクの状態が変更されました' },
          { status: 409 }
        )
      }

      // 監査ログ
      createAuditLog({
        supabase: admin,
        orgId: task.org_id,
        spaceId: task.space_id,
        actorId: tokenRecord.recipient_user_id,
        actorRole: 'client',
        eventType: 'estimate.approved',
        targetType: 'task',
        targetId: task.id,
        summary: generateAuditSummary('estimate.approved', { title: task.title }),
        dataBefore: { estimate_status: 'pending' },
        dataAfter: { estimate_status: 'approved' },
        metadata: { estimated_cost: task.estimated_cost, via: 'email' },
        visibility: 'client',
      }).catch(err => console.error('Audit log failed (email estimate_approve):', err))

      // Slack通知（見積もり承認）
      fireSlackNotification(request.nextUrl.origin, {
        event: 'estimate_approved',
        taskId: task.id,
        spaceId: task.space_id,
        actorId: tokenRecord.recipient_user_id,
        changes: {
          oldEstimateStatus: 'pending',
          newEstimateStatus: 'approved',
        },
      })
    } else {
      // タスク承認
      if (task.estimate_status === 'pending') {
        return NextResponse.json(
          { error: '見積もりの確認が必要です。ポータルから操作してください。' },
          { status: 409 }
        )
      }

      const { data: updated, error: updateError } = await admin
        .from('tasks')
        .update({
          status: 'done',
          ball: 'internal',
          updated_at: now,
        })
        .eq('id', task.id)
        .eq('ball', 'client')
        .neq('status', 'done')
        .neq('estimate_status', 'pending')
        .select('id')
        .maybeSingle()

      if (updateError) {
        console.error('[email-action] approve update failed:', updateError)
        return NextResponse.json({ error: 'サーバーエラー' }, { status: 500 })
      }
      if (!updated) {
        return NextResponse.json(
          { error: 'タスクの状態が変更されました' },
          { status: 409 }
        )
      }

      // 監査ログ
      createAuditLog({
        supabase: admin,
        orgId: task.org_id,
        spaceId: task.space_id,
        actorId: tokenRecord.recipient_user_id,
        actorRole: 'client',
        eventType: 'approval.approved',
        targetType: 'task',
        targetId: task.id,
        summary: generateAuditSummary('approval.approved', { title: task.title }),
        dataBefore: { status: task.status, ball: task.ball },
        dataAfter: { status: 'done', ball: 'internal' },
        metadata: { via: 'email' },
        visibility: 'client',
      }).catch(err => console.error('Audit log failed (email approve):', err))

      // Slack通知（タスク承認）
      fireSlackNotification(request.nextUrl.origin, {
        event: 'status_changed',
        taskId: task.id,
        spaceId: task.space_id,
        actorId: tokenRecord.recipient_user_id,
        changes: {
          oldStatus: task.status,
          newStatus: 'done',
        },
      })
    }

    // トークンを使用済みにする
    await admin
      .from('email_action_tokens')
      .update({ used_at: now })
      .eq('id', tokenRecord.id)

    const message = tokenRecord.action_type === 'estimate_approve'
      ? '見積もりを承認しました'
      : '承認しました'

    return NextResponse.json({ success: true, message })
  } catch (error) {
    console.error('[email-action] POST error:', error)
    return NextResponse.json({ error: 'サーバーエラー' }, { status: 500 })
  }
}
