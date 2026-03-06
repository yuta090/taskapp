import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAuditLog, generateAuditSummary } from '@/lib/audit'
import type { SupabaseClient } from '@supabase/supabase-js'

const MAX_TITLE_LENGTH = 200
const MAX_DESCRIPTION_LENGTH = 5000
const VALID_CATEGORIES = ['bug', 'feature', 'question'] as const
type RequestCategory = (typeof VALID_CATEGORIES)[number]

interface RequestBody {
  title: string
  category: RequestCategory
  description?: string
}

/**
 * Fire-and-forget server-side notification.
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
): void {
  const secret = process.env.INTERNAL_NOTIFY_SECRET
  if (!secret) return

  const origin = request.nextUrl.origin
  fetch(`${origin}/api/slack/notify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-secret': secret,
    },
    body: JSON.stringify(params),
  }).catch((err) => {
    console.warn('[portal-request-notify] Failed:', err)
  })
}

/** Map category to a label prefix for task title */
function categoryLabel(category: RequestCategory): string {
  switch (category) {
    case 'bug': return 'BUG'
    case 'feature': return 'REQ'
    case 'question': return 'Q&A'
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body: RequestBody = await request.json()
    const { title, category, description } = body

    // Validation
    if (!title || title.trim().length === 0) {
      return NextResponse.json(
        { error: 'タイトルは必須です' },
        { status: 400 }
      )
    }
    if (title.length > MAX_TITLE_LENGTH) {
      return NextResponse.json(
        { error: `タイトルは${MAX_TITLE_LENGTH}文字以内にしてください` },
        { status: 400 }
      )
    }
    if (!category || !VALID_CATEGORIES.includes(category)) {
      return NextResponse.json(
        { error: '無効なカテゴリです' },
        { status: 400 }
      )
    }
    if (description && description.length > MAX_DESCRIPTION_LENGTH) {
      return NextResponse.json(
        { error: `説明は${MAX_DESCRIPTION_LENGTH}文字以内にしてください` },
        { status: 400 }
      )
    }

    // Get the user's client membership (space + org)
    const { data: membership } = await (supabase as SupabaseClient)
      .from('space_memberships')
      .select(`
        space_id,
        spaces!inner (
          id,
          org_id
        )
      `)
      .eq('user_id', user.id)
      .eq('role', 'client')
      .limit(1)
      .single()

    if (!membership) {
      return NextResponse.json(
        { error: 'アクセス権限がありません' },
        { status: 403 }
      )
    }

    const spaceId = membership.space_id
    const spaces = membership.spaces as unknown as { org_id: string }
    const orgId = spaces.org_id

    // Create the task with origin=client, ball=internal
    const label = categoryLabel(category)
    const taskTitle = `[${label}] ${title.trim()}`
    const now = new Date().toISOString()

    const { data: task, error: insertError } = await (supabase as SupabaseClient)
      .from('tasks')
      .insert({
        org_id: orgId,
        space_id: spaceId,
        title: taskTitle,
        description: description?.trim() || null,
        status: 'open',
        ball: 'internal',
        origin: 'client',
        type: 'task',
        client_scope: 'deliverable',
        created_at: now,
        updated_at: now,
      })
      .select('id')
      .single()

    if (insertError || !task) {
      console.error('[portal-request] Insert error:', insertError)
      return NextResponse.json(
        { error: 'リクエストの送信に失敗しました' },
        { status: 500 }
      )
    }

    // Audit log (fire-and-forget)
    createAuditLog({
      supabase,
      orgId,
      spaceId,
      actorId: user.id,
      actorRole: 'client',
      eventType: 'task.created',
      targetType: 'task',
      targetId: task.id,
      summary: generateAuditSummary('task.created', { title: taskTitle }),
      dataAfter: { title: taskTitle, origin: 'client', category },
      visibility: 'client',
    }).catch(err => console.error('Audit log failed (portal request):', err))

    // Slack notification (fire-and-forget)
    fireServerNotification(request, {
      event: 'task_created',
      taskId: task.id,
      spaceId,
      actorId: user.id,
      changes: { origin: 'client', category },
    })

    return NextResponse.json({
      success: true,
      taskId: task.id,
      message: 'リクエストを送信しました',
    })
  } catch (error) {
    console.error('[portal-request] Error:', error)
    return NextResponse.json(
      { error: 'サーバーエラーが発生しました' },
      { status: 500 }
    )
  }
}
