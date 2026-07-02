import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendApprovalEmail } from '@/lib/email/approval'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * POST /api/portal/notify-approval
 *
 * ボールがクライアントに移動した際に呼び出される内部API。
 * - クライアントオーナーのメールアドレスを取得
 * - email_action_tokens を作成
 * - 承認依頼メールを送信
 *
 * 認証: ログインユーザーのセッション（内部UIから呼び出される）
 */
export async function POST(request: NextRequest) {
  try {
    // 呼び出し元の認証確認
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { taskId, spaceId } = body as { taskId: string; spaceId: string }

    if (!taskId || !spaceId) {
      return NextResponse.json({ error: 'taskId and spaceId required' }, { status: 400 })
    }

    const admin = createAdminClient()

    // タスク詳細を取得
    const { data: task, error: taskError } = await (admin as SupabaseClient)
      .from('tasks')
      .select('id, title, org_id, space_id, ball, estimate_status, estimated_cost')
      .eq('id', taskId)
      .single()

    if (taskError || !task) {
      console.warn('[notify-approval] Task not found:', taskId)
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    // ボールがクライアントでない場合はスキップ
    if (task.ball !== 'client') {
      return NextResponse.json({ skipped: true, reason: 'ball is not client' })
    }

    // アクション種別を決定
    const actionType = task.estimate_status === 'pending' ? 'estimate_approve' : 'approve'

    // クライアントオーナーを取得
    const { data: taskOwners } = await (admin as SupabaseClient)
      .from('task_owners')
      .select('user_id')
      .eq('task_id', taskId)
      .eq('side', 'client')

    let recipients: { user_id: string }[] = taskOwners || []

    if (recipients.length === 0) {
      // オーナー未設定の場合、スペースのクライアントメンバー全員に送信
      const { data: clientMembers } = await (admin as SupabaseClient)
        .from('space_memberships')
        .select('user_id')
        .eq('space_id', spaceId)
        .eq('role', 'client')

      if (!clientMembers || clientMembers.length === 0) {
        return NextResponse.json({ skipped: true, reason: 'no client members' })
      }

      recipients = clientMembers
    }

    // ユーザーIDからメールアドレスを取得
    const userIds = [...new Set(recipients.map((o) => o.user_id))]

    const { data: profiles } = await (admin as SupabaseClient)
      .from('profiles')
      .select('id, email')
      .in('id', userIds)

    if (!profiles || profiles.length === 0) {
      // profiles にない場合は auth.users から取得
      const emailMap = new Map<string, string>()
      for (const uid of userIds) {
        const { data: { user: authUser } } = await admin.auth.admin.getUserById(uid)
        if (authUser?.email) {
          emailMap.set(uid, authUser.email)
        }
      }
      if (emailMap.size === 0) {
        return NextResponse.json({ skipped: true, reason: 'no email addresses found' })
      }

      // profiles がない場合のフォールバック
      await sendEmailsToUsers(admin, task, actionType, emailMap, spaceId)
      return NextResponse.json({ success: true, sent: emailMap.size })
    }

    const emailMap = new Map<string, string>()
    for (const p of profiles) {
      if (p.email) {
        emailMap.set(p.id, p.email)
      }
    }

    // profiles にメールがないユーザーは auth.users から取得
    for (const uid of userIds) {
      if (!emailMap.has(uid)) {
        const { data: { user: authUser } } = await admin.auth.admin.getUserById(uid)
        if (authUser?.email) {
          emailMap.set(uid, authUser.email)
        }
      }
    }

    if (emailMap.size === 0) {
      return NextResponse.json({ skipped: true, reason: 'no email addresses found' })
    }

    await sendEmailsToUsers(admin, task, actionType, emailMap, spaceId)

    return NextResponse.json({ success: true, sent: emailMap.size })
  } catch (error) {
    console.error('[notify-approval] Error:', error)
    // Fire-and-forget なので 200 を返す（呼び出し元のUIに影響させない）
    return NextResponse.json({ error: 'Internal error' }, { status: 200 })
  }
}

interface TaskData {
  id: string
  title: string
  org_id: string
  space_id: string
  estimate_status: string
  estimated_cost: number | null
}

async function sendEmailsToUsers(
  admin: ReturnType<typeof createAdminClient>,
  task: TaskData,
  actionType: 'approve' | 'estimate_approve',
  emailMap: Map<string, string>,
  spaceId: string,
) {
  // スペース名・組織名を取得
  const { data: space } = await (admin as SupabaseClient)
    .from('spaces')
    .select('name, org_id, organizations!inner(name)')
    .eq('id', spaceId)
    .single()

  const spaceName = (space as Record<string, unknown>)?.name as string || 'プロジェクト'
  const orgName = ((space as Record<string, unknown>)?.organizations as Record<string, unknown>)?.name as string || ''

  // 既存の未使用トークンを無効化（同一タスク・ユーザーの重複防止）
  const userIds = [...emailMap.keys()]
  await (admin as SupabaseClient)
    .from('email_action_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('task_id', task.id)
    .in('recipient_user_id', userIds)
    .is('used_at', null)

  // 各ユーザーにトークン生成 + メール送信
  const sendPromises = [...emailMap.entries()].map(async ([userId, email]) => {
    try {
      // トークン作成
      const { data: tokenRecord, error: tokenError } = await (admin as SupabaseClient)
        .from('email_action_tokens')
        .insert({
          task_id: task.id,
          space_id: spaceId,
          org_id: task.org_id,
          recipient_user_id: userId,
          recipient_email: email,
          action_type: actionType,
        })
        .select('token')
        .single()

      if (tokenError || !tokenRecord) {
        console.error('[notify-approval] Token creation failed:', tokenError)
        return
      }

      // メール送信
      await sendApprovalEmail({
        to: email,
        token: tokenRecord.token,
        taskTitle: task.title,
        spaceName,
        orgName,
        actionType,
        estimatedCost: task.estimated_cost,
      })
    } catch (err) {
      console.error(`[notify-approval] Failed to send to ${email}:`, err)
    }
  })

  await Promise.allSettled(sendPromises)
}
