import { after, NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { mfaGuardResponse } from '@/lib/auth/apiMfaGuard'
import { createAuditLog, generateAuditSummary } from '@/lib/audit'
import { isPortalSectionEnabled } from '@/lib/portal/checkPortalSection'
import { isValidUuid } from '@/lib/uuid'
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
  /** The project the screen was showing when the request was submitted (S6-style multi-project accounts). */
  spaceId?: string
}

/**
 * Server-side notification. Returns a promise so callers can hand it to
 * `after()` and keep the function alive until the request actually settles
 * (a plain un-awaited fetch can be cut off once the response is sent).
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
): Promise<void> {
  const secret = process.env.INTERNAL_NOTIFY_SECRET
  if (!secret) return Promise.resolve()

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL
  if (!appUrl) return Promise.resolve()
  const baseUrl = appUrl.startsWith('http') ? appUrl : `https://${appUrl}`
  return fetch(`${baseUrl}/api/slack/notify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-secret': secret,
    },
    body: JSON.stringify(params),
  }).then(
    () => undefined,
    (err) => {
      console.warn('[portal-request-notify] Failed:', err)
    }
  )
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
    // 二要素認証: 登録済み × コード未入力(aal1) は service role で触る前に弾く（RLS 経由でない経路の防衛）
    const mfaBlock = await mfaGuardResponse(supabase as SupabaseClient, user)
    if (mfaBlock) return mfaBlock

    const body: RequestBody = await request.json()
    const { title, category, description, bugDetails, spaceId: requestedSpaceId } = body

    // Validation: spaceId, when present, must be a real UUID — the column it
    // is compared against is a Postgres uuid, so a malformed value would
    // otherwise fail as an opaque 500 instead of a clear 400.
    if (requestedSpaceId !== undefined && !isValidUuid(requestedSpaceId)) {
      return NextResponse.json(
        { error: 'プロジェクトの指定が不正です' },
        { status: 400 }
      )
    }

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

    // Get the user's client membership (space + org). When the screen tells us
    // which project it was showing (spaceId), confirm membership on exactly
    // that project so the request always lands where the client meant it to —
    // never on an arbitrary one of their other projects.
    let membershipQuery = (supabase as SupabaseClient)
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

    if (requestedSpaceId) {
      membershipQuery = membershipQuery.eq('space_id', requestedSpaceId)
    }

    const { data: memberships, error: membershipError } = await membershipQuery

    if (membershipError) {
      console.error('[portal-request] Membership query error:', membershipError)
      return NextResponse.json(
        { error: 'サーバーエラーが発生しました' },
        { status: 500 }
      )
    }

    if (!memberships || memberships.length === 0) {
      return NextResponse.json(
        { error: 'アクセス権限がありません' },
        { status: 403 }
      )
    }

    // Legacy callers that don't say which project they mean can only be
    // resolved unambiguously when the client belongs to exactly one project.
    if (!requestedSpaceId && memberships.length > 1) {
      return NextResponse.json(
        { error: '画面を再読み込みしてから、もう一度送信してください' },
        { status: 400 }
      )
    }

    const membership = memberships[0]
    const spaceId = membership.space_id
    const spaces = membership.spaces as unknown as { org_id: string }
    const orgId = spaces.org_id

    // Check if requests section is enabled for this space
    if (!(await isPortalSectionEnabled(supabase as SupabaseClient, spaceId, 'requests'))) {
      return NextResponse.json(
        { error: 'リクエスト送信は現在無効になっています' },
        { status: 403 }
      )
    }

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

    // 相手先(client)の操作は、本人の確認(membership)をログイン中のセッションで
    // 行った上で、実際の書き込みはサーバー側(service role)で行う。space_id は
    // 上で確かめた membership の値に固定する。
    const admin = createAdminClient()

    const { data: task, error: insertError } = await (admin as SupabaseClient)
      .from('tasks')
      .insert({
        org_id: orgId,
        space_id: spaceId,
        title: taskTitle,
        description: taskDescription,
        status: 'todo',
        ball: 'internal',
        origin: 'client',
        type: 'task',
        client_scope: 'deliverable',
        created_by: user.id,
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

    // Audit log and Slack notification must still run after the response is
    // sent, so they are handed to after() instead of being fired-and-forgotten
    // (an un-awaited write can otherwise be cut off once the response goes out).
    after(() =>
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
    )

    after(() =>
      fireServerNotification(request, {
        event: 'task_created',
        taskId: task.id,
        spaceId,
        actorId: user.id,
        changes: { origin: 'client', category },
      })
    )

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
