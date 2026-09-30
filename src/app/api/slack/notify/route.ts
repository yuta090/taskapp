import { NextRequest, NextResponse } from 'next/server'
import { mfaGuardResponse } from '@/lib/auth/apiMfaGuard'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { createRouteAuth } from '@/lib/supabase/routeAuth'
import { notificationRegistry } from '@/lib/notifications'
import { SlackNotificationProvider } from '@/lib/slack/provider'
import type { NotificationEventType, TaskNotificationPayload } from '@/lib/notifications/types'

export const runtime = 'nodejs'

if (!notificationRegistry.get('slack')) {
  notificationRegistry.register(new SlackNotificationProvider())
}

const ALLOWED_EVENTS: NotificationEventType[] = [
  'task_created',
  'ball_passed',
  'status_changed',
  'comment_added',
]

/**
 * POST /api/slack/notify — 自動通知トリガー
 * hooksからfire-and-forgetで呼ばれる
 */
export async function POST(request: NextRequest) {
  try {
    // 認証: ユーザーセッション or 内部シークレット
    let actorId: string | null = null
    let sessionClient: SupabaseClient | null = null

    const internalSecret = request.headers.get('x-internal-secret')
    const isInternalCall =
      internalSecret && internalSecret === process.env.INTERNAL_NOTIFY_SECRET

    if (!isInternalCall) {
      // ブラウザの Cookie、またはスマホアプリの Bearer トークン（src/lib/supabase/routeAuth.ts）
      const auth = await createRouteAuth(request)
      if (!auth) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      // 二要素認証: 登録済み × コード未入力(aal1) は service role で触る前に弾く
      const mfaBlock = await mfaGuardResponse(auth.supabase as SupabaseClient, auth.user, auth.accessToken)
      if (mfaBlock) return mfaBlock
      actorId = auth.user.id
      sessionClient = auth.supabase as SupabaseClient
    }

    const body = await request.json()
    const { event, taskId, spaceId, actorId: bodyActorId, changes } = body

    if (!ALLOWED_EVENTS.includes(event) || !taskId || !spaceId) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    // 内部呼び出しの場合はbodyからactorIdを取得
    const resolvedActorId = actorId || bodyActorId || null
    const admin = createAdminClient({
      channel: 'app',
      actorUserId: resolvedActorId ?? undefined,
    }) as SupabaseClient

    // タスク・Space・Actor・Assignee情報を並列取得
    const [taskResult, spaceResult, actorResult] = await Promise.all([
      admin
        .from('tasks')
        .select('*')
        .eq('id', taskId)
        .eq('space_id', spaceId)
        .single(),
      admin
        .from('spaces')
        .select('name, org_id')
        .eq('id', spaceId)
        .single(),
      resolvedActorId
        ? admin
            .from('profiles')
            .select('display_name')
            .eq('id', resolvedActorId)
            .single()
        : Promise.resolve({ data: null }),
    ])

    const task = taskResult.data
    const space = spaceResult.data

    if (!task || !space) {
      return NextResponse.json({ error: 'Task or space not found' }, { status: 404 })
    }

    // 呼んだ人がそのタスクの組織かプロジェクトのメンバーか（相手先は除く）。確かめないと、ログインさえ
    // していれば他の組織の taskId/spaceId を指定して、その組織の Slack に投稿させられる。
    // service role ではなく本人のクライアント（RLS が効く側）で確かめる。内部呼び出し（合言葉付き）は対象外
    if (sessionClient && actorId) {
      const isMember = (row: { role?: string } | null) => !!row && row.role !== 'client'
      const { data: orgRow } = await sessionClient
        .from('org_memberships')
        .select('role')
        .eq('org_id', space.org_id)
        .eq('user_id', actorId)
        .maybeSingle()
      let allowed = isMember(orgRow as { role?: string } | null)
      if (!allowed) {
        const { data: spaceRow } = await sessionClient
          .from('space_memberships')
          .select('role')
          .eq('space_id', spaceId)
          .eq('user_id', actorId)
          .maybeSingle()
        allowed = isMember(spaceRow as { role?: string } | null)
      }
      if (!allowed) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    // Assignee名取得
    let assigneeName: string | null = null
    if (task.assignee_id) {
      const { data: assigneeProfile } = await admin
        .from('profiles')
        .select('display_name')
        .eq('id', task.assignee_id)
        .single()
      assigneeName = assigneeProfile?.display_name || null
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

    const payload: TaskNotificationPayload = {
      task: {
        id: task.id,
        title: task.title,
        status: task.status,
        ball: task.ball,
        origin: task.origin,
        type: task.type,
        dueDate: task.due_date,
        assigneeName,
        description: task.description,
      },
      spaceName: space.name,
      actorName: actorResult.data?.display_name || undefined,
      appUrl: `${appUrl}/${space.org_id}/project/${spaceId}`,
      changes: changes || undefined,
    }

    const results = await notificationRegistry.notifyAll(
      event as NotificationEventType,
      {
        orgId: space.org_id,
        spaceId,
        taskId,
        actorId: resolvedActorId || undefined,
      },
      payload,
    )

    return NextResponse.json({ success: true, results })
  } catch (err) {
    console.error('Slack notify error:', err)
    return NextResponse.json({ error: 'Failed to notify' }, { status: 500 })
  }
}
