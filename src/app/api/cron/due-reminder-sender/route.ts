import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import {
  claimDueReminderOccurrences,
  finalizeDueReminderOccurrence,
  findTaskSnapshotForReminder,
  findOrgIdForSpace,
  findConnectionFreshness,
  isDueReminderEnabledForUser,
  isOrgDueRemindersEnabled,
  type DueReminderOccurrenceRow,
} from '@/lib/reminders/dueReminderStore'
import { checkDueReminderStaleness } from '@/lib/reminders/dueReminderStaleness'
import { buildDueReminderFlex } from '@/lib/reminders/dueReminderMessages'
import { resolveOrgEntitlements, type Feature, type PlanId } from '@/lib/billing/entitlements'
import {
  findActiveUserLinkForUser,
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
 * §6/§6.1/§9・PR-1）。claim → 送信直前の3条件staleness再確認 → org単位オンオフ再確認 →
 * entitlement再確認 → 宛先解決(1:1 DMのみ) → 統一送信境界(sendSecretaryPush)で送信 → finalize、を行う。
 *
 * うざくない秘書 再設計（Fable+Codex一致裁定）: 配信はDM(1:1)私信のみ。旧版にあった
 * 「発生元チャットグループ→spaceのactiveグループ」への催促文面フォールバックは廃止した
 * （グループに個人向けの催促を出さない・§2）。DMルートが無ければ suppressed('no_route') で
 * 終端し、channel-digestの中立な期限セクション（安全網）に委ねる。
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

  // perf是正: isOrgDueRemindersEnabled も同様にorg単位でメモ化する。以前はoccurrenceごとに
  // 都度問い合わせており、claim上限(100件)まで同一orgのoccurrenceが並ぶと最大100回の
  // 無駄クエリになっていた（entitlementCacheと同型）。
  const orgDueRemindersEnabledCache = new Map<string, Promise<boolean>>()
  function getOrgDueRemindersEnabledCached(orgId: string) {
    let cached = orgDueRemindersEnabledCache.get(orgId)
    if (!cached) {
      cached = isOrgDueRemindersEnabled(orgId)
      orgDueRemindersEnabledCache.set(orgId, cached)
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

      // org単位の自動期限リマインドオンオフ（org_channel_policy.due_reminders_enabled・§2）。
      // entitlement再確認と同じ位置づけ＝送信境界での抑止。falseなら事務所全体で停止する。
      const orgDueRemindersEnabled = await getOrgDueRemindersEnabledCached(orgId)
      if (!orgDueRemindersEnabled) {
        await finalizeDueReminderOccurrence(occ.id, 'suppressed', 'org_reminders_disabled')
        skipped.push({ occurrenceId: occ.id, taskId: task.id, reason: 'org_reminders_disabled' })
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
        assigneeId: task.assigneeId,
        canDirectDm: entitlements.has('line_direct_dm'),
      })
      if (!destination) {
        await finalizeDueReminderOccurrence(occ.id, 'suppressed', 'no_route')
        skipped.push({ occurrenceId: occ.id, taskId: task.id, reason: 'no_route' })
        continue
      }

      // 確認ボタン付きFlex（[完了した][対応中][明日また確認]・設計正本 §7・PR-2）。
      // altText=本文（buildDueReminderTextと同一）でtext版の見た目を保つ。
      const flexMessage = buildDueReminderFlex({
        kind: occ.kind,
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
// 宛先解決（DM(1:1)のみ・§9・うざくない秘書 再設計）
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

/**
 * 宛先解決（設計正本 §9・うざくない秘書 再設計）:
 *   (1) Pro＋line_direct_dm＋active user link → 1:1 DM
 *   (2) DM不能 → null（呼び出し側が suppressed('no_route') にする）
 *
 * 旧版にあった「発生元チャットグループ→spaceのactiveグループ」への催促文面フォールバック
 * (tier-2) は廃止した。グループに個人向けの督促を出さない契約を配線レベルで保証するため、
 * この関数はDM以外の宛先を一切返さない。安全網はchannel-digestの中立な期限セクション。
 * ball は宛先を変えない（ball=client/internalどちらでも内側担当者のDMへ届く）。
 */
async function resolveDestination(params: {
  orgId: string
  assigneeId: string
  canDirectDm: boolean
}): Promise<ResolvedDestination | null> {
  const { orgId, assigneeId, canDirectDm } = params
  if (!canDirectDm) return null
  return resolveDmCandidate(orgId, assigneeId)
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
