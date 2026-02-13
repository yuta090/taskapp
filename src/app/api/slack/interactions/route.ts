import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifySlackRequest } from '@/lib/slack/verify'
import { parseTaskCreateSubmission } from '@/lib/slack/modals'
import { resolveTaskAppUser } from '@/lib/slack/usermap'
import { postSlackMessage } from '@/lib/slack/client'

export const runtime = 'nodejs'

let _supabaseAdmin: ReturnType<typeof createClient> | null = null
function getSupabaseAdmin() {
  if (!_supabaseAdmin) {
    _supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _supabaseAdmin
}

/**
 * Fire-and-forget 内部通知
 */
function fireNotification(
  origin: string,
  params: {
    event: string
    taskId: string
    spaceId: string
    actorId?: string
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
    console.warn('[slack-interactions] Notification failed:', err)
  })
}

/**
 * POST /api/slack/interactions — Slack interactive component handler
 */
export async function POST(request: NextRequest) {
  // 1. Verify signature
  const { verified, body } = await verifySlackRequest(request)
  if (!verified) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  // 2. Parse URL-encoded payload
  const params = new URLSearchParams(body)
  const rawPayload = params.get('payload')
  if (!rawPayload) {
    return NextResponse.json({ error: 'Missing payload' }, { status: 400 })
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(rawPayload)
  } catch {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  // 3. Route by type
  if (payload.type === 'view_submission') {
    const view = payload.view as Record<string, unknown>
    const callbackId = view?.callback_id

    if (callbackId === 'task_create_modal') {
      return handleTaskCreate(request, payload)
    }
  }

  // Unknown interaction type — acknowledge
  return new NextResponse(null, { status: 200 })
}

async function handleTaskCreate(
  request: NextRequest,
  payload: Record<string, unknown>,
) {
  const view = payload.view as Record<string, unknown>

  // Parse form values
  let submission: ReturnType<typeof parseTaskCreateSubmission>
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    submission = parseTaskCreateSubmission(view as any)
  } catch {
    return NextResponse.json({
      response_action: 'errors',
      errors: { block_title: '入力内容を解析できませんでした' },
    })
  }

  const { title, assigneeId, dueDate, description, spaceId, channelId } = submission

  // Validate title
  if (!title || title.trim().length === 0) {
    return NextResponse.json({
      response_action: 'errors',
      errors: { block_title: 'タイトルを入力してください' },
    })
  }

  // Look up org_id from space
  const { data: space, error: spaceError } = await (getSupabaseAdmin() as any)
    .from('spaces')
    .select('org_id')
    .eq('id', spaceId)
    .single()

  if (spaceError || !space) {
    return NextResponse.json({
      response_action: 'errors',
      errors: { block_title: 'プロジェクトが見つかりませんでした' },
    })
  }

  const orgId = space.org_id as string

  // Resolve Slack user → TaskApp user (best-effort)
  const slackUserId = (payload.user as Record<string, unknown>)?.id as string | undefined
  let createdBy: string | null = null
  if (slackUserId) {
    const resolved = await resolveTaskAppUser(slackUserId, orgId)
    if (resolved) {
      createdBy = resolved.userId
    }
  }

  // Insert task
  const now = new Date().toISOString()
  const { data: task, error: insertError } = await (getSupabaseAdmin() as any)
    .from('tasks')
    .insert({
      org_id: orgId,
      space_id: spaceId,
      title: title.trim(),
      description: description?.trim() || null,
      status: 'backlog',
      ball: 'internal',
      origin: 'internal',
      type: 'task',
      client_scope: 'deliverable',
      due_date: dueDate || null,
      assignee_id: assigneeId || null,
      created_by: createdBy,
      created_at: now,
      updated_at: now,
    })
    .select('id')
    .single()

  if (insertError || !task) {
    console.error('[slack-interactions] Task insert failed:', insertError)
    return NextResponse.json({
      response_action: 'errors',
      errors: { block_title: 'タスクの作成に失敗しました。もう一度お試しください。' },
    })
  }

  // Fire-and-forget: notification + confirmation message
  const origin = request.nextUrl.origin

  fireNotification(origin, {
    event: 'task_created',
    taskId: task.id,
    spaceId,
    actorId: createdBy || undefined,
  })

  if (channelId) {
    postSlackMessage(
      orgId,
      channelId,
      `タスク「${title.trim()}」を作成しました`,
      [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `✅ タスク「${title.trim()}」を作成しました`,
          },
        },
      ],
    ).catch((err) => {
      console.warn('[slack-interactions] Confirmation message failed:', err)
    })
  }

  // Close modal
  return NextResponse.json({ response_action: 'clear' })
}
