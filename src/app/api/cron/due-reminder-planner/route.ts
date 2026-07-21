import { NextRequest, NextResponse } from 'next/server'
import {
  findDueReminderCandidateTasks,
  materializeDueReminderOccurrences,
} from '@/lib/reminders/dueReminderStore'
import { buildDueReminderOccurrenceDraftsForTasks } from '@/lib/reminders/dueReminderPlanner'

/**
 * POST /api/cron/due-reminder-planner
 *
 * pg_cron が定期的に呼ぶ内部API（設計正本 docs/spec/AI_SECRETARY_STAGE5_DUE_REMINDERS.md
 * §6.1・PR-1）。due_date を持つ対象タスク（status<>done・assignee_id あり）から、
 * 既定オフセット群（[-1440, 0, +1440]分）の occurrence を
 * task_due_reminder_occurrences へ `on conflict (task_id,due_snapshot,offset_minutes) do nothing`
 * で materialize する（冪等・PR-0のunique制約に依拠。RPC/トリガーは新規に足さない）。
 *
 * entitlement-blind: このcronは課金プランを一切見ない（生成はプラン非依存）。
 * 未entitled orgの抑止は sender 側の送信直前ゲート（真実の境界）で行う（§9）。
 *
 * 認証: Authorization: Bearer ${CRON_SECRET}（他cronと同一パターン）。
 */
export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('[due-reminder-planner] CRON_SECRET is not configured')
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }

  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()

  const candidates = await findDueReminderCandidateTasks()
  const drafts = buildDueReminderOccurrenceDraftsForTasks(candidates, now)

  let materialized = 0
  try {
    materialized = await materializeDueReminderOccurrences(drafts)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[due-reminder-planner] materialize failed: ${message}`)
    return NextResponse.json(
      { error: 'materialize_failed', message, candidates: candidates.length, drafts: drafts.length },
      { status: 500 },
    )
  }

  return NextResponse.json({
    candidates: candidates.length,
    drafts: drafts.length,
    materialized,
  })
}
