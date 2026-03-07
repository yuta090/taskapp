import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAuditLog, generateAuditSummary } from '@/lib/audit'
import type { SupabaseClient } from '@supabase/supabase-js'

const MAX_TITLE_LENGTH = 200
const MAX_FIELD_LENGTH = 2000
const MAX_DESCRIPTION_LENGTH = 5000
const VALID_CATEGORIES = ['bug', 'feature', 'question'] as const
const VALID_FREQUENCIES = ['every_time', 'sometimes', 'once'] as const
type RequestCategory = (typeof VALID_CATEGORIES)[number]
type BugFrequency = (typeof VALID_FREQUENCIES)[number]

interface BugDetails {
  screen: string
  steps: string
  actual: string
  expected: string
  frequency: BugFrequency
}

interface RequestBody {
  title: string
  category: RequestCategory
  description?: string
  bugDetails?: BugDetails
}

/**
 * Fire-and-forget server-side notification.
 */
function fireServerNotification(
  _request: NextRequest,
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

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL
  if (!appUrl) return
  const baseUrl = appUrl.startsWith('http') ? appUrl : `https://${appUrl}`
  fetch(`${baseUrl}/api/slack/notify`, {
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

const FREQUENCY_LABELS: Record<BugFrequency, string> = {
  every_time: '毎回',
  sometimes: 'ときどき',
  once: '1回だけ',
}

/** Build structured description for bug reports */
function buildBugDescription(
  bugDetails: BugDetails,
  userAgent: string,
  note?: string,
): string {
  const sections = [
    `## 発生画面\n${bugDetails.screen}`,
    `## 再現手順\n${bugDetails.steps}`,
    `## 実際の動作\n${bugDetails.actual}`,
    `## 期待する動作\n${bugDetails.expected}`,
    `## 発生頻度\n${FREQUENCY_LABELS[bugDetails.frequency]}`,
  ]

  if (note) {
    sections.push(`## 補足\n${note}`)
  }

  sections.push(`## 環境情報\n\`${userAgent}\``)

  return sections.join('\n\n')
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 })
    }

    const body: RequestBody = await request.json()
    const { title, category, description, bugDetails } = body

    // Validation: common fields
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

    // Validation: bug-specific fields
    if (category === 'bug') {
      if (!bugDetails) {
        return NextResponse.json(
          { error: 'バグの詳細情報が必要です' },
          { status: 400 }
        )
      }
      const requiredBugFields: { key: keyof BugDetails; label: string }[] = [
        { key: 'screen', label: '発生した画面' },
        { key: 'steps', label: '再現手順' },
        { key: 'actual', label: '実際に起きたこと' },
        { key: 'expected', label: '期待する動作' },
      ]
      for (const field of requiredBugFields) {
        const val = bugDetails[field.key]
        if (typeof val !== 'string' || val.trim().length === 0) {
          return NextResponse.json(
            { error: `${field.label}は必須です` },
            { status: 400 }
          )
        }
        if (val.length > MAX_FIELD_LENGTH) {
          return NextResponse.json(
            { error: `${field.label}は${MAX_FIELD_LENGTH}文字以内にしてください` },
            { status: 400 }
          )
        }
      }
      if (!bugDetails.frequency || !VALID_FREQUENCIES.includes(bugDetails.frequency)) {
        return NextResponse.json(
          { error: '発生頻度を選択してください' },
          { status: 400 }
        )
      }
    }

    // Validation: feature/question requires description
    if (category !== 'bug' && (!description || description.trim().length === 0)) {
      return NextResponse.json(
        { error: category === 'feature' ? '機能の内容を入力してください' : '質問内容を入力してください' },
        { status: 400 }
      )
    }

    // Get the user's client membership (space + org)
    const { data: membership, error: membershipError } = await (supabase as SupabaseClient)
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

    if (membershipError && membershipError.code !== 'PGRST116') {
      // PGRST116 = no rows found (permission issue), other codes = DB error
      console.error('[portal-request] Membership query error:', membershipError)
      return NextResponse.json(
        { error: 'サーバーエラーが発生しました' },
        { status: 500 }
      )
    }

    if (!membership) {
      return NextResponse.json(
        { error: 'アクセス権限がありません' },
        { status: 403 }
      )
    }

    const spaceId = membership.space_id
    const spaces = membership.spaces as unknown as { org_id: string }
    const orgId = spaces.org_id

    // Build description
    const userAgent = request.headers.get('user-agent') || 'unknown'
    let taskDescription: string | null

    if (category === 'bug' && bugDetails) {
      taskDescription = buildBugDescription(bugDetails, userAgent, description?.trim())
    } else {
      taskDescription = description?.trim() || null
    }

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
        description: taskDescription,
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
