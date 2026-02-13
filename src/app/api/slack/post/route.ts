import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { notificationRegistry } from '@/lib/notifications'
import { SlackNotificationProvider } from '@/lib/slack/provider'
import type { TaskNotificationPayload } from '@/lib/notifications/types'

export const runtime = 'nodejs'

// Slack provider を登録（初回リクエスト時）
if (!notificationRegistry.get('slack')) {
  notificationRegistry.register(new SlackNotificationProvider())
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { taskId, spaceId, customMessage } = body

    if (!taskId || !spaceId) {
      return NextResponse.json(
        { error: 'taskId and spaceId are required' },
        { status: 400 },
      )
    }

    if (customMessage && (typeof customMessage !== 'string' || customMessage.length > 2000)) {
      return NextResponse.json(
        { error: 'customMessage must be a string under 2000 characters' },
        { status: 400 },
      )
    }

    // Space membership チェック
    const { data: membership } = await (supabase as any)
      .from('space_memberships')
      .select('role')
      .eq('space_id', spaceId)
      .eq('user_id', user.id)
      .single()

    if (!membership) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // タスク情報取得（space_idで所属チェック）
    const { data: task } = await (supabase as any)
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .eq('space_id', spaceId)
      .single()

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    // Space情報取得
    const { data: space } = await (supabase as any)
      .from('spaces')
      .select('name, org_id')
      .eq('id', spaceId)
      .single()

    if (!space) {
      return NextResponse.json({ error: 'Space not found' }, { status: 404 })
    }

    // Actor名取得
    const { data: profile } = await (supabase as any)
      .from('profiles')
      .select('display_name')
      .eq('id', user.id)
      .single()

    // Assignee名取得
    let assigneeName: string | null = null
    if (task.assignee_id) {
      const { data: assigneeProfile } = await (supabase as any)
        .from('profiles')
        .select('display_name')
        .eq('id', task.assignee_id)
        .single()
      assigneeName = assigneeProfile?.display_name || null
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:4000'

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
      actorName: profile?.display_name || user.email || 'Unknown',
      customMessage: customMessage || undefined,
      appUrl: `${appUrl}/${space.org_id}/project/${spaceId}`,
    }

    const results = await notificationRegistry.notifyAll(
      'task_shared',
      {
        orgId: space.org_id,
        spaceId,
        taskId,
        actorId: user.id,
      },
      payload,
    )

    return NextResponse.json({ success: true, results })
  } catch (err) {
    console.error('Slack post error:', err)
    return NextResponse.json(
      { error: 'Failed to post to Slack' },
      { status: 500 },
    )
  }
}
