import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import {
  claimDueReminderOccurrences,
  finalizeDueReminderOccurrence,
  findTaskSnapshotForReminder,
  findOrgIdForSpace,
  findConnectionFreshness,
  isDueReminderEnabledForUser,
  type DueReminderOccurrenceRow,
} from '@/lib/reminders/dueReminderStore'
import { checkDueReminderStaleness } from '@/lib/reminders/dueReminderStaleness'
import { buildDueReminderFlex } from '@/lib/reminders/dueReminderMessages'
import { resolveOrgEntitlements, type Feature, type PlanId } from '@/lib/billing/entitlements'
import {
  findActiveUserLinkForUser,
  findChatOriginGroupForTask,
  findGroupById,
  findActiveGroupForSpace,
  findLineAccountByIdLookup,
  type LineAccount,
} from '@/lib/channels/store'
import { sendSecretaryPush } from '@/lib/channels/send/secretaryPush'
import { getJstDayOfYear } from '@/lib/channels/metering/decideAutoPush'
import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * POST /api/cron/due-reminder-sender
 *
 * pg_cron が定期的に呼ぶ内部API（設計正本 docs/spec/AI_SECRETARY_STAGE5_DUE_REMINDERS.md
 * §6/§6.1/§9・PR-1）。claim → 送信直前の3条件staleness再確認 → entitlement再確認 →
 * 宛先解決(§A 3段) → 統一送信境界(sendSecretaryPush)で送信 → finalize、を行う。
 *
 * 認証: Authorization: Bearer ${CRON_SECRET}（他cronと同一パターン）。
 */
const DEFAULT_CLAIM_LIMIT = 100

export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('[due-reminder-sender] CRON_SECRET is not configured')
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }

  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const jstDayOfYear = getJstDayOfYear(now)
  const admin = createAdminClient() as SupabaseClient

  const claimed = await claimDueReminderOccurrences(DEFAULT_CLAIM_LIMIT, now)

  let sent = 0
  const skipped: Array<{ occurrenceId: string; taskId: string; reason: string }> = []

  // org単位でエンタイトルメントを1回だけ解決してキャッシュ（同一cron実行内での重複DB呼び出し削減）。
  const entitlementCache = new Map<string, Promise<{ planId: PlanId; has: (f: Feature) => boolean }>>()
  function getEntitlements(orgId: string) {
    let cached = entitlementCache.get(orgId)
    if (!cached) {
      cached = resolveOrgEntitlements(admin, orgId, now)
      entitlementCache.set(orgId, cached)
    }
    return cached
  }

  for (const occ of claimed) {
    // code review #2(a): ループ本体全体を try/catch で包む。前段（task再読取り・接続鮮度・
    // org解決・entitlement解決・宛先解決）で想定外にthrowすると、ここで捕まえずに外へ
    // 伝播すると1回のfetch失敗でハンドラごと500になり、以降のoccurrenceが処理されず
    // 永久に詰まる（siblingsを巻き込む）。ここではlogしてこのoccurrenceだけskipし、
    // 次のoccurrenceへ進む。finalizeはしない（原因不明の失敗を安易にsuppressed/deferred
    // 終端にせず、lease失効による自然な再試行に委ねる）。
    try {
      const task = await findTaskSnapshotForReminder(occ.taskId)
      if (!task) {
        await finalizeDueReminderOccurrence(occ.id, 'suppressed', 'task_not_found')
        skipped.push({ occurrenceId: occ.id, taskId: occ.taskId, reason: 'task_not_found' })
        continue
      }

      // §6 staleness 3条件（送信直前の再読取り）。1つでも欠けたら suppressed 終端。
      const connectionInfo = task.dueAuthorityConnectionId
        ? await findConnectionFreshness(task.dueAuthorityConnectionId)
        : null
      const staleness = checkDueReminderStaleness(task, occ.dueSnapshot, connectionInfo, now)
      if (!staleness.ok) {
        await finalizeDueReminderOccurrence(occ.id, 'suppressed', staleness.reason)
        skipped.push({ occurrenceId: occ.id, taskId: task.id, reason: staleness.reason })
        continue
      }

      // v1は assignee_id が無いタスクの occurrence を生成しない（§9）が、生成後に外れた場合の防御。
      if (!task.assigneeId) {
        await finalizeDueReminderOccurrence(occ.id, 'suppressed', 'no_assignee')
        skipped.push({ occurrenceId: occ.id, taskId: task.id, reason: 'no_assignee' })
        continue
      }

      const orgId = await findOrgIdForSpace(task.spaceId)
      if (!orgId) {
        await finalizeDueReminderOccurrence(occ.id, 'suppressed', 'org_not_found')
        skipped.push({ occurrenceId: occ.id, taskId: task.id, reason: 'org_not_found' })
        continue
      }

      // entitlement 再確認（真実の境界）。not_entitled は suppressed 終端（deferredにしない・§6.1）。
      const entitlements = await getEntitlements(orgId)
      if (!entitlements.has('timed_line_reminders')) {
        await finalizeDueReminderOccurrence(occ.id, 'suppressed', 'not_entitled')
        skipped.push({ occurrenceId: occ.id, taskId: task.id, reason: 'not_entitled' })
        continue
      }

      // 利用者個人ごとの受信オプトアウト（profiles.due_reminder_enabled）。entitlement再確認と
      // 同じ位置づけ＝送信境界での抑止。false（明示オプトアウト）のみ suppressed 終端にする
      // （行が無い/null はfail-open=trueでこの分岐に入らない）。
      const recipientEnabled = await isDueReminderEnabledForUser(task.assigneeId)
      if (!recipientEnabled) {
        await finalizeDueReminderOccurrence(occ.id, 'suppressed', 'recipient_opted_out')
        skipped.push({ occurrenceId: occ.id, taskId: task.id, reason: 'recipient_opted_out' })
        continue
      }

      const destination = await resolveDestination({
        orgId,
        spaceId: task.spaceId,
        assigneeId: task.assigneeId,
        taskId: task.id,
        canDirectDm: entitlements.has('line_direct_dm'),
      })
      if (!destination) {
        await finalizeDueReminderOccurrence(occ.id, 'suppressed', 'no_route')
        skipped.push({ occurrenceId: occ.id, taskId: task.id, reason: 'no_route' })
        continue
      }

      // 確認ボタン付きFlex（[完了した][まだ][○日後に再通知]・設計正本 §7・PR-2）。
      // altText=本文（buildDueReminderTextと同一）でtext版の見た目を保つ。
      const flexMessage = buildDueReminderFlex({
        kind: occ.kind,
        ball: task.ball,
        title: task.title,
        taskId: task.id,
        occurrenceId: occ.id,
        snoozeCount: occ.sendCount,
      })

      const destinationId = destination.record.groupId ?? destination.record.externalUserId ?? 'unknown'
      const retryKey = buildDueReminderRetryKey(occ, destinationId)

      try {
        const result = await sendSecretaryPush({
          account: destination.account,
          orgId,
          to: destination.to,
          messages: [flexMessage],
          retryKey,
          jstDayOfYear,
          record: {
            spaceId: task.spaceId,
            identityId: null,
            groupId: destination.record.groupId,
            externalUserId: destination.record.externalUserId,
            body: flexMessage.altText,
            payload: {
              kind: 'due-reminder',
              taskId: task.id,
              occurrenceId: occ.id,
              dueReminderKind: occ.kind,
            },
          },
        })

        if (result.delivered) {
          await finalizeDueReminderOccurrence(occ.id, 'sent')
          sent += 1
        } else {
          // 予算/縮退による抑止のみ deferred（pending差戻し・翌窓再送・attempt上限で打ち止め・§6.1）。
          await finalizeDueReminderOccurrence(occ.id, 'deferred', result.reason)
          skipped.push({ occurrenceId: occ.id, taskId: task.id, reason: result.reason })
        }
      } catch (err) {
        if (isPermanentLinePushFailure(err)) {
          // code review #2(b): 恒久失敗（トークン失効等のLINE 4xx・429除く）はfinalizeせずに
          // 放置すると lease失効→再claim→再push→再throw を無限に繰り返す
          // （attempt上限はdeferred経路のRPCでしか効かないため、finalizeしないと打ち止まらない）。
          // suppressed終端にして再claim対象から外す。
          await finalizeDueReminderOccurrence(occ.id, 'suppressed', 'push_failed_permanent')
          skipped.push({ occurrenceId: occ.id, taskId: task.id, reason: 'push_failed_permanent' })
        } else {
          // 一時失敗（429/5xx/ネットワーク/不明）: finalizeせず lease 失効に委ねる（次回claimで
          // 再送・同一retryKeyでLINE側dedupe）。ここで deferred にすると「配信済みかもしれない」
          // ケースで scheduled_at を1時間先送りしてしまい再送が遅れるため、finalizeしない方が安全。
          const message = err instanceof Error ? err.message : String(err)
          skipped.push({ occurrenceId: occ.id, taskId: task.id, reason: `push_failed: ${message}` })
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[due-reminder-sender] occurrence ${occ.id} unexpected error: ${message}`)
      skipped.push({ occurrenceId: occ.id, taskId: occ.taskId, reason: `unexpected_error: ${message}` })
    }
  }

  return NextResponse.json({ claimed: claimed.length, sent, skipped })
}

// ---------------------------------------------------------------------------
// 宛先解決（§A 3段固定優先・§9）
// ---------------------------------------------------------------------------

interface ResolvedDestination {
  account: LineAccount
  to: string
  record: { groupId: string | null; externalUserId: string | null }
}

async function resolveDmCandidate(orgId: string, assigneeId: string): Promise<ResolvedDestination | null> {
  const link = await findActiveUserLinkForUser(orgId, assigneeId)
  if (!link) return null
  const lookup = await findLineAccountByIdLookup(link.channelAccountId)
  if (!lookup?.account) return null
  return {
    account: lookup.account,
    to: link.externalUserId,
    record: { groupId: null, externalUserId: link.externalUserId },
  }
}

async function resolveOriginGroupCandidate(taskId: string): Promise<ResolvedDestination | null> {
  const origin = await findChatOriginGroupForTask(taskId)
  if (!origin) return null
  const group = await findGroupById(origin.groupId)
  if (!group || group.status !== 'active') return null
  const lookup = await findLineAccountByIdLookup(group.accountId)
  if (!lookup?.account) return null
  return {
    account: lookup.account,
    to: group.externalGroupId,
    record: { groupId: group.id, externalUserId: null },
  }
}

async function resolveSpaceGroupCandidate(
  orgId: string,
  spaceId: string,
): Promise<ResolvedDestination | null> {
  const group = await findActiveGroupForSpace(orgId, spaceId)
  if (!group) return null
  const lookup = await findLineAccountByIdLookup(group.accountId)
  if (!lookup?.account) return null
  return {
    account: lookup.account,
    to: group.externalGroupId,
    record: { groupId: group.id, externalUserId: null },
  }
}

/**
 * 宛先解決（設計正本 §9 §A）:
 *   (1) Pro＋line_direct_dm＋active user link → 1:1 DM
 *   (2) 発生元チャットグループ → 無ければ space の active グループ
 *   (3) ルート皆無 → null（呼び出し側が suppressed('no_route') にする）
 * ball は宛先を変えない（宛先はどちらのballでも内側担当者で共通。変わるのは文面のみ）。
 */
async function resolveDestination(params: {
  orgId: string
  spaceId: string
  assigneeId: string
  taskId: string
  canDirectDm: boolean
}): Promise<ResolvedDestination | null> {
  const { orgId, spaceId, assigneeId, taskId, canDirectDm } = params

  if (canDirectDm) {
    const dm = await resolveDmCandidate(orgId, assigneeId)
    if (dm) return dm
  }

  const origin = await resolveOriginGroupCandidate(taskId)
  if (origin) return origin

  return resolveSpaceGroupCandidate(orgId, spaceId)
}

/**
 * 決定的な retryKey。(task_id, due_snapshot, offset_minutes, send_count, 宛先識別子) が同じなら
 * 同じキーになる。宛先識別子（groupId/externalUserId）を必ず含める — 同一キーで複数宛先だと
 * LINEのdedupeにより2件目以降の配信が欠落する（PR-0.5 task-reminders HIGH修正と同じ穴・§6.1）。
 *
 * code review #3是正: 既存 buildDigestRetryKey（src/lib/channels/digest/compute.ts）と同じ
 * sha256＋UUID v4 の version(4)/variant(8-b) ビット設定手法に揃える。以前のFNV系整形では
 * バージョン/バリアントビットが立たず、LINEが `X-Line-Retry-Key` をUUID厳格検証した場合に
 * 全due pushが400になり得た。生成入力（raw文字列）は変えない。
 */
function buildDueReminderRetryKey(occ: DueReminderOccurrenceRow, destinationId: string): string {
  const raw = `due-reminder:${occ.taskId}:${occ.dueSnapshot}:${occ.offsetMinutes}:${occ.sendCount}:${destinationId}`
  const hex = createHash('sha256').update(raw).digest('hex')
  const variantNibble = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${variantNibble}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-')
}

/**
 * push例外を恒久/一時に切り分ける（code review #2(b)是正）。
 *   - 恒久: LINE 4xx（429=レート制限を除く。トークン失効・宛先不正など再試行しても直らない）
 *   - 一時: 429/5xx/ネットワーク断/不明（再試行すれば直る可能性がある）
 * pushLineMessage（@/lib/channels/line/client）は非2xxで LinePushError(status, message) を
 * 投げる契約（sendSecretaryPushはこれをそのまま re-throw する・secretaryPush.ts自体は変更しない）。
 * instanceof ではなく「numberのstatusを持つか」で判定する（モジュール同一性に依存しないダック
 * タイピング。テストでも実クラスを構築せず済む）。
 */
function isPermanentLinePushFailure(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const status = (err as { status?: unknown }).status
  if (typeof status !== 'number') return false
  if (status === 429) return false
  return status >= 400 && status < 500
}
