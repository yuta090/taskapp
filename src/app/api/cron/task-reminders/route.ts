import { NextRequest, NextResponse } from 'next/server'
import {
  findDueTaskReminders,
  findActiveGroupsForSpaces,
  markTaskReminderSent,
} from '@/lib/reminders/taskReminderStore'
import { findLineAccountById } from '@/lib/channels/store'
import { pushLineMessage } from '@/lib/channels/line/client'
import {
  selectDueTaskReminders,
  buildTaskReminderText,
  type TaskReminderInput,
} from '@/lib/reminders/computeTaskReminders'
import { resolveOrgEntitlements } from '@/lib/billing/entitlements'
import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * POST /api/cron/task-reminders
 *
 * pg_cron が5分毎に app_invoke_task_reminders() 経由で呼ぶ内部API。
 * remind_at が到来済みで未送信のタスクを、space に紐づくactiveなLINEグループへ
 * 秘書のリマインドとして push する（③ 時刻指定リマインド・pro以上限定）。
 *
 * ゲート（Fable裁定・二重防御の実行時側／真実の境界）:
 *   送信直前に org の timed_line_reminders エンタイトルメントを再確認し、
 *   未entitledなら送らず remind_sent_at も刻まない（fail-closed。後でアップグレード
 *   すれば到来済みリマインドが届く）。org帰属は channel_groups.org_id を真実源にする。
 *
 * 二重送信防止:
 *   - remind_sent_at >= remind_at のタスクは selectDueTaskReminders が除外
 *   - retryKey を (taskId, remindAt) で決定的にし、pg_net二重起動でもLINE側で弾く
 *   - push成功後にのみ remind_sent_at を刻む（失敗は次回cronで再送）
 *
 * 認証: Authorization: Bearer ${CRON_SECRET}（他cronと同一パターン）。
 */
export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('[task-reminders] CRON_SECRET is not configured')
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }

  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  let body: Record<string, unknown> = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }
  const dryRun = url.searchParams.get('dryRun') === 'true' || body.dryRun === true

  const now = new Date()
  const nowISO = now.toISOString() // 絶対時刻の記録・比較（日付成分抽出ではないので toISOString で正しい）

  const candidates = await findDueTaskReminders(nowISO)
  const due = selectDueTaskReminders({ tasks: candidates, now })

  if (due.length === 0) {
    return NextResponse.json({ due: 0, sent: 0, skipped: [], ...(dryRun ? { dryRun: true, plan: [] } : {}) })
  }

  const spaceIds = [...new Set(due.map((t) => t.spaceId))]
  const links = await findActiveGroupsForSpaces(spaceIds)
  const linksBySpace = new Map<string, typeof links>()
  for (const link of links) {
    const list = linksBySpace.get(link.spaceId) || []
    list.push(link)
    linksBySpace.set(link.spaceId, list)
  }

  const admin = createAdminClient() as SupabaseClient
  // org単位でエンタイトルメントを1回だけ解決してキャッシュ
  const entitlementByOrg = new Map<string, boolean>()
  async function isOrgEntitled(orgId: string): Promise<boolean> {
    const cached = entitlementByOrg.get(orgId)
    if (cached !== undefined) return cached
    const ent = await resolveOrgEntitlements(admin, orgId, now)
    const has = ent.has('timed_line_reminders')
    entitlementByOrg.set(orgId, has)
    return has
  }

  const skipped: Array<{ taskId: string; reason: string }> = []
  const plan: Array<{ taskId: string; groups: string[] }> = []
  let sent = 0

  for (const task of due) {
    const taskLinks = linksBySpace.get(task.spaceId) || []
    if (taskLinks.length === 0) {
      skipped.push({ taskId: task.id, reason: 'no_linked_group' })
      continue
    }

    const text = buildTaskReminderText(task)
    let deliveredAtLeastOnce = false
    const plannedGroups: string[] = []

    for (const link of taskLinks) {
      // 実行時ゲート（真実の境界）: 未entitledは送らない・sentも付けない
      if (!(await isOrgEntitled(link.orgId))) {
        skipped.push({ taskId: task.id, reason: 'not_entitled' })
        continue
      }

      if (dryRun) {
        plannedGroups.push(link.externalGroupId)
        continue
      }

      const account = await findLineAccountById(link.accountId)
      if (!account) {
        skipped.push({ taskId: task.id, reason: 'account_not_found' })
        continue
      }

      try {
        await pushLineMessage({
          accessToken: account.accessToken,
          to: link.externalGroupId,
          messages: [{ type: 'text', text }],
          retryKey: buildReminderRetryKey(task),
        })
        deliveredAtLeastOnce = true
      } catch (err) {
        skipped.push({
          taskId: task.id,
          reason: `push_failed: ${err instanceof Error ? err.message : 'unknown'}`,
        })
      }
    }

    if (dryRun) {
      if (plannedGroups.length > 0) plan.push({ taskId: task.id, groups: plannedGroups })
      continue
    }

    if (deliveredAtLeastOnce) {
      try {
        await markTaskReminderSent(task.id, nowISO)
        sent += 1
      } catch (err) {
        skipped.push({
          taskId: task.id,
          reason: `mark_sent_failed: ${err instanceof Error ? err.message : 'unknown'}`,
        })
      }
    }
  }

  return NextResponse.json({
    due: due.length,
    sent,
    skipped,
    ...(dryRun ? { dryRun: true, plan } : {}),
  })
}

/**
 * 決定的な retryKey。(taskId, remindAt) が同じなら同じキーになり、
 * pg_net の二重起動・手動再実行でもLINE側で二重配信を弾く。remind_at を
 * 変更（再アーム）した場合はキーも変わるので、新しいリマインドは配信される。
 * UUID v5 相当の形にするため、決定的入力を UUID 形式へ整形する。
 */
function buildReminderRetryKey(task: TaskReminderInput): string {
  const raw = `${task.id}:${task.remindAt}`
  // 単純な決定的ハッシュ（32桁hex）→ UUID形式に整形。衝突耐性より決定性が目的。
  let h1 = 0x811c9dc5
  let h2 = 0x1000193
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x1000193) >>> 0
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0
  }
  const hex = (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).padEnd(32, '0')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}
