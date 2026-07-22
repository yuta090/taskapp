import { NextRequest, NextResponse } from 'next/server'
import {
  findDueReminderCandidateTasks,
  findOrgIdsWithDueRemindersDisabled,
  materializeDueReminderOccurrences,
} from '@/lib/reminders/dueReminderStore'
import { buildDueReminderOccurrenceDraftsForTasks } from '@/lib/reminders/dueReminderPlanner'

/**
 * POST /api/cron/due-reminder-planner
 *
 * pg_cron が定期的に呼ぶ内部API（設計正本 docs/spec/AI_SECRETARY_STAGE5_DUE_REMINDERS.md
 * §6.1・PR-1）。due_date を持つ対象タスク（status<>done・assignee_id あり）から、
 * 既定オフセット群（[0, +1440]分＝当日/超過1回。うざくない秘書 再設計で「1日前」を撤去）の
 * occurrence を task_due_reminder_occurrences へ
 * `on conflict (task_id,due_snapshot,offset_minutes) do nothing` で materialize する
 * （冪等・PR-0のunique制約に依拠。RPC/トリガーは新規に足さない）。
 *
 * entitlement-blind: このcronは課金プランを一切見ない（生成はプラン非依存）。
 * 未entitled orgの抑止は sender 側の送信直前ゲート（真実の境界）で行う（§9）。
 *
 * org単位の自動期限リマインドオンオフ（org_channel_policy.due_reminders_enabled・§2）は
 * entitlementとは別に、この cron でも判定する。off の org は新規occurrenceをそもそも
 * 作らない（既に materialize 済みの occurrence の送信抑止は sender 側が担う）。
 * perf是正: 候補タスク自体が `spaces!inner(org_id)` 埋め込みでorgIdを持つため、以前あった
 * space_id→org_id の別クエリ往復（findOrgIdsForSpaces）は廃止した。
 *
 * HIGH-2是正（フェイルクローズ退行防止）: org設定の読み取りに失敗しても materialize 自体は
 * 続行する（fail-open）。dueReminderStore.findOrgIdsWithDueRemindersDisabled は既に内部で
 * DBエラーを空集合へfail-openするが、ここでも二重に try/catch で包み、想定外の例外で
 * ハンドラごと500になって「候補は取れているのに1件もmaterializeされない」事故を防ぐ
 * （24hのgraceがあるため、停止した分は障害復旧後も恒久的に失われる）。
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

  // org単位オンオフ（§2）: disabled org のタスクは新規occurrenceを作らない。
  let disabledOrgIds = new Set<string>()
  if (candidates.length > 0) {
    try {
      disabledOrgIds = await findOrgIdsWithDueRemindersDisabled()
    } catch (err) {
      // HIGH-2是正: ここで例外を伝播させるとハンドラごと500になり、org設定と無関係な
      // 全候補のmaterializeまで止まってしまう。fail-open(disabled=空集合)で続行する。
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[due-reminder-planner] org disabled lookup failed, failing open: ${message}`)
    }
  }
  const eligibleCandidates = candidates.filter((c) => !disabledOrgIds.has(c.orgId))

  const drafts = buildDueReminderOccurrenceDraftsForTasks(eligibleCandidates, now)

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
