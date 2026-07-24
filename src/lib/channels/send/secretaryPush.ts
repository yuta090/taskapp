import type { LineMessage } from '@/lib/channels/line/client'
import {
  getOrgChannelPolicyState,
  getPlatformBudgetState,
  insertChannelMessage,
  findOutboundMessageByExternalId,
} from '@/lib/channels/store'
import { decideSharedSendBudget } from '@/lib/channels/metering/decideSharedSendBudget'
import { deliverToChannel } from '@/lib/channels/adapters'

/**
 * 統一送信境界（設計正本 docs/spec/AI_SECRETARY_STAGE5_DUE_REMINDERS.md §9・PR-0.5／
 * マルチチャネル化 PR1）。
 *
 * 唯一のチャネル対応秘書送信境界。LINEも非LINEも必ずここを通り、実送信は
 * deliverToChannel（各チャネルのアダプタ）に委譲する。
 *
 * 予算判定（org層 org_channel_policy ＋ グローバル層 platform_channel_budget の二層）は
 * channel==='line' のときだけ行う。理由: 予算が掛かるのは当社（共有bot/LINE無料枠）の
 * 持ち出しがある送信だけであり、非LINEチャネルは事務所自身のアカウント（bot_token・
 * webhook_url等）で送るため当社の持ち出しが無い（PR1・Fable裁定）。
 *   - org層: org_channel_policy（getOrgChannelPolicyState）
 *   - グローバル層: platform_channel_budget（owner_type='platform' の共有botのみ。
 *     専用bot(owner_type='org')は顧客側の枠であり当社の持ち出しではないため常に'ok'扱い）
 * を通過したときだけ push し、push成功後に channel==='line' のときだけ billable_push:true で
 * outbound 記録（channel_messages）を残す（設計正本 §3・PR4メータリング）。
 *
 * 非LINEはサーバ側idempotencyが無い（LINEのX-Line-Retry-Keyに相当するものが無い）ため、
 * 送信前に同一(account, retryKey)のoutbound記録が既にあれば送信しない
 * （TOCTOUは残るが被害は報告の二重送信のみで許容する・store.findOutboundMessageByExternalId
 * のコメント参照）。LINEはLINE側dedupeがあるためこのチェックを行わない（現行挙動維持）。
 *
 * entitlement（機能フラグ）の再確認はこの境界に含めない — feature key は送信目的
 * （承認催促は無ゲート／時刻リマインドは timed_line_reminders 等）ごとに呼び出し側で
 * 異なるため、呼び出し側 cron の責務とする。本境界はステートレスで、予算抑止時
 * （delivered:false）でも呼び出し側の「未送信」状態（claim戻し等）は一切変更しない
 * ——それも呼び出し側の責務（approval-notify の clearApprovalNotifiedAt、
 * task-reminders の markTaskReminderSent 未呼び出し、など）。
 *
 * 将来的には approval-notify 自身もこの境界へ寄せられる想定だが、今回（PR-0.5）は
 * 既存挙動を変えないため見送る（Fable裁定）。
 */

export interface SecretaryPushAccount {
  id: string
  ownerType: 'org' | 'platform'
  /** 省略時 'line'（既存呼び出し元の後方互換） */
  channel?: string
  /** LINE の access token（後方互換）。非LINEは credentials を使う */
  accessToken?: string
  /** 復号済み credentials。非LINEはこちらが正 */
  credentials?: Record<string, string>
}

/** channel_messages の outbound 記録に載せる帰属情報。 */
export interface SecretaryPushRecord {
  spaceId: string | null
  identityId: string | null
  /** グループ発言の帰属（不変列）。1:1メッセージは null */
  groupId: string | null
  externalUserId: string | null
  body: string | null
  payload: Record<string, unknown>
}

export interface SendSecretaryPushInput {
  account: SecretaryPushAccount
  orgId: string
  /** 送信先（LINE userId/groupId・Slackチャンネル・Chatworkルームid等。チャネルごとに意味が異なる） */
  to: string
  /** 全チャネル共通の床（プレーンテキスト）。必須 — 非LINEアダプタとLINEの代替表現に使う */
  text: string
  /** LINEのリッチ表現（Flex等）。指定時はLINEアダプタがそのまま messages として送る */
  messages?: LineMessage[]
  /**
   * チャネル固有の送信文脈（teamsのgroup.metadata.serviceUrl等）。deliverToChannelへそのまま
   * 素通しするだけ（判定ロジックは持たない）。省略時はundefined（既存呼び出し元の後方互換）。
   * 解釈するアダプタのみが使う。
   */
  providerContext?: Record<string, string>
  /** 決定的キー。HTTPリトライ・cron二重起動でも二重配信/二重計上しない */
  retryKey: string
  /** JST基準の通算日（1..366）。org層・global層の隔日縮退が使う（LINEのみ参照） */
  jstDayOfYear: number
  record: SecretaryPushRecord
  /**
   * 任意: グローバル予算層(platform_channel_budget)の読み取り器。省略時は store を直接読む
   * （毎回1回のDB読取）。呼び出し1回分（cron 1実行など）のスコープでメモ化した関数を渡せば、
   * 同一accountを複数グループが引く場合の重複読取を呼び出し側で削減できる——ただし判定に使う
   * "値"を差し替えるものではなく"読み取り方"の差し替えであり、判定ロジックの権威はこの境界に
   * 残る（budgetStateOverrideのような値の直接注入とは異なる）。本境界自身は状態を持たない
   * （リクエスト間の汚染を避けるためモジュールレベルのキャッシュはここには置かない）。
   */
  resolvePlatformBudgetState?: (accountId: string) => Promise<'ok' | 'soft' | 'hard'>
}

export type SendSecretaryPushResult = { delivered: true } | { delivered: false; reason: string }

export async function sendSecretaryPush(
  input: SendSecretaryPushInput,
): Promise<SendSecretaryPushResult> {
  const { account, orgId, to, text, messages, retryKey, jstDayOfYear, record, providerContext } = input
  const channel = account.channel ?? 'line'
  const credentials = account.credentials ?? (account.accessToken ? { access_token: account.accessToken } : {})
  const resolvePlatformBudgetState = input.resolvePlatformBudgetState ?? getPlatformBudgetState

  if (channel === 'line') {
    const policy = await getOrgChannelPolicyState(orgId)
    const globalState =
      account.ownerType === 'platform' ? await resolvePlatformBudgetState(account.id) : 'ok'
    const decision = decideSharedSendBudget({
      org: { state: policy.state, onExceed: policy.onExceed },
      global: { state: globalState },
      jstDayOfYear,
    })
    if (!decision.deliver) {
      return { delivered: false, reason: decision.reason ?? 'quota_suppressed' }
    }
  } else {
    const existing = await findOutboundMessageByExternalId(account.id, retryKey)
    if (existing) {
      return { delivered: false, reason: 'already_delivered' }
    }
  }

  const result = await deliverToChannel(channel, {
    credentials,
    to,
    text,
    rich: messages,
    idempotencyKey: retryKey,
    providerContext,
  })

  if (!result.ok) {
    throw new Error(
      `secretary push failed (channel=${channel}, status=${result.status ?? 'n/a'}): ${result.error ?? 'unknown error'}`,
    )
  }

  const billablePush = channel === 'line'
  const payload = result.externalMessageId
    ? { ...record.payload, provider_message_id: result.externalMessageId }
    : record.payload

  // push成功後にoutbound記録を残す（billablePushはLINEのみtrue。設計正本 §3・PR4メータリング）。
  // externalMessageId は retryKey と同一キーにする（決定的キーでdedupe。二重起動でも
  // channel_messages_dedupe unique indexにより二重計上しない）。
  await insertChannelMessage({
    orgId,
    spaceId: record.spaceId,
    identityId: record.identityId,
    accountId: account.id,
    groupId: record.groupId,
    channel,
    direction: 'outbound',
    actor: 'secretary',
    externalUserId: record.externalUserId,
    externalMessageId: retryKey,
    contentType: 'text',
    body: record.body,
    payload,
    storagePath: null,
    status: 'sent',
    error: null,
    occurredAt: new Date().toISOString(),
    billablePush,
  })

  return { delivered: true }
}
