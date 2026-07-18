import { NextRequest, NextResponse } from 'next/server'
import { isValidUuid } from '@/lib/uuid'
import { requireInternalMember } from '@/lib/channels/authz'
import { findTaskOrgId, setTaskRemindAt } from '@/lib/reminders/taskReminderStore'
import { resolveOrgEntitlements } from '@/lib/billing/entitlements'
import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

/**
 * POST /api/tasks/[taskId]/reminder — 時刻指定LINEリマインドの設定/解除（③・pro以上限定）
 *
 * body: { remindAt: string(ISO) | null }
 *
 * 認可: 内部メンバーのみ。org はタスクからサーバ側で逆引きし（クライアント申告を信用しない）、
 * その org のメンバーであることを検証する。
 *
 * 設定時ゲート（Fable裁定・二重防御のUX側）: remindAt を設定する場合のみ、org の
 * timed_line_reminders エンタイトルメントを確認し、無ければ 403 plan_required。
 * 解除（remindAt=null）はプラン不問（失効orgが既存設定を消せるように）。
 * ※真の境界は cron 送信時の再確認（未entitledは配信しない）。
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await params
  if (!isValidUuid(taskId)) {
    return NextResponse.json({ error: 'invalid taskId' }, { status: 400 })
  }

  let body: Record<string, unknown> = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  const rawRemindAt = body.remindAt
  let remindAt: string | null
  if (rawRemindAt === null || rawRemindAt === undefined) {
    remindAt = null
  } else if (typeof rawRemindAt === 'string') {
    const ms = new Date(rawRemindAt).getTime()
    if (Number.isNaN(ms)) {
      return NextResponse.json({ error: 'invalid remindAt' }, { status: 400 })
    }
    remindAt = new Date(ms).toISOString() // 絶対時刻に正規化
  } else {
    return NextResponse.json({ error: 'invalid remindAt' }, { status: 400 })
  }

  const task = await findTaskOrgId(taskId)
  if (!task) {
    return NextResponse.json({ error: 'task not found' }, { status: 404 })
  }

  const auth = await requireInternalMember(task.orgId)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  // 設定時のみプランを確認（解除はプラン不問）
  if (remindAt !== null) {
    const admin = createAdminClient() as SupabaseClient
    const ent = await resolveOrgEntitlements(admin, task.orgId)
    if (!ent.has('timed_line_reminders')) {
      return NextResponse.json(
        { error: 'plan_required', feature: 'timed_line_reminders' },
        { status: 403 },
      )
    }
  }

  await setTaskRemindAt(taskId, remindAt)
  return NextResponse.json({ ok: true, remindAt })
}
