import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { notificationRegistry } from '@/lib/notifications'
import { SlackNotificationProvider } from '@/lib/slack/provider'
import type { NotificationEventType, TaskNotificationPayload } from '@/lib/notifications/types'

export const runtime = 'nodejs'

if (!notificationRegistry.get('slack')) {
  notificationRegistry.register(new SlackNotificationProvider())
}

let _supabaseAdmin: ReturnType<typeof createSupabaseClient> | null = null
function getSupabaseAdmin() {
  if (!_supabaseAdmin) {
    _supabaseAdmin = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _supabaseAdmin
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

    const internalSecret = request.headers.get('x-internal-secret')
    const isInternalCall =
      internalSecret && internalSecret === process.env.INTERNAL_NOTIFY_SECRET

    if (!isInternalCall) {
      const supabase = await createClient()
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      actorId = user.id
    }

    const body = await request.json()
    const { event, taskId, spaceId, actorId: bodyActorId, changes } = body

    if (!ALLOWED_EVENTS.includes(event) || !taskId || !spaceId) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    // 内部呼び出しの場合はbodyからactorIdを取得
    const resolvedActorId = actorId || bodyActorId || null

    // タスク・Space・Actor・Assignee情報を並列取得
    const [taskResult, spaceResult, actorResult] = await Promise.all([
      (getSupabaseAdmin() as any)
        .from('tasks')
        .select('*')
        .eq('id', taskId)
        .eq('space_id', spaceId)
        .single(),
      (getSupabaseAdmin() as any)
        .from('spaces')
        .select('name, org_id')
        .eq('id', spaceId)
        .single(),
      resolvedActorId
        ? (getSupabaseAdmin() as any)
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

    // Assignee名取得
    let assigneeName: string | null = null
    if (task.assignee_id) {
      const { data: assigneeProfile } = await (getSupabaseAdmin() as any)
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
