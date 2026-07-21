import { pushLineMessage, type LineMessage } from '@/lib/channels/line/client'
import {
  getOrgChannelPolicyState,
  getPlatformBudgetState,
  insertChannelMessage,
} from '@/lib/channels/store'
import { decideSharedSendBudget } from '@/lib/channels/metering/decideSharedSendBudget'

/**
 * 統一送信境界（設計正本 docs/spec/AI_SECRETARY_STAGE5_DUE_REMINDERS.md §9・PR-0.5）。
 *
 * 正典 src/app/api/cron/approval-notify/route.ts（76-139行）の送信/メータリング部を
 * 忠実に一般化したもの。二層予算判定
 *   - org層: org_channel_policy（getOrgChannelPolicyState）
 *   - グローバル層: platform_channel_budget（owner_type='platform' の共有botのみ。
 *     専用bot(owner_type='org')は顧客側の枠であり当社の持ち出しではないため常に'ok'扱い）
 * を通過したときだけ push し、push成功後に billable_push:true で outbound 記録
 * （channel_messages）を残す（設計正本 §3・PR4メータリング）。
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
  accessToken: string
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
  /** LINE userId (1:1) または groupId (group) */
  to: string
  messages: LineMessage[]
  /** 決定的キー。HTTPリトライ・cron二重起動でも二重配信/二重計上しない */
  retryKey: string
  /** JST基準の通算日（1..366）。org層・global層の隔日縮退が使う */
  jstDayOfYear: number
  record: SecretaryPushRecord
}

export type SendSecretaryPushResult = { delivered: true } | { delivered: false; reason: string }

export async function sendSecretaryPush(
  input: SendSecretaryPushInput,
): Promise<SendSecretaryPushResult> {
  const { account, orgId, to, messages, retryKey, jstDayOfYear, record } = input

  const policy = await getOrgChannelPolicyState(orgId)
  const globalState = account.ownerType === 'platform' ? await getPlatformBudgetState(account.id) : 'ok'
  const decision = decideSharedSendBudget({
    org: { state: policy.state, onExceed: policy.onExceed },
    global: { state: globalState },
    jstDayOfYear,
  })

  if (!decision.deliver) {
    return { delivered: false, reason: decision.reason ?? 'quota_suppressed' }
  }

  await pushLineMessage({
    accessToken: account.accessToken,
    to,
    messages,
    retryKey,
  })

  // push成功後にoutbound記録（billablePush=true）を残す（設計正本 §3・PR4メータリング）。
  // externalMessageId は retryKey と同一キーにする（決定的キーでdedupe。二重起動でも
  // channel_messages_dedupe unique indexにより二重計上しない）。
  await insertChannelMessage({
    orgId,
    spaceId: record.spaceId,
    identityId: record.identityId,
    accountId: account.id,
    groupId: record.groupId,
    channel: 'line',
    direction: 'outbound',
    actor: 'secretary',
    externalUserId: record.externalUserId,
    externalMessageId: retryKey,
    contentType: 'text',
    body: record.body,
    payload: record.payload,
    storagePath: null,
    status: 'sent',
    error: null,
    occurredAt: new Date().toISOString(),
    billablePush: true,
  })

  return { delivered: true }
}
