import {
  extractUserLinkCode,
  looksLikeUserLinkCode,
  maskUserLinkCode,
  hashUserLinkCode,
} from '@/lib/channels/userLink'
import { hashSharedGroupClaimCode, generateGroupClaimChallengeLabel } from '@/lib/channels/sharedGroupClaim'
import {
  findLineAccountByDestination,
  findActiveLineIdentities,
  insertChannelMessage,
  findValidLinkCode,
  linkIdentityViaCode,
  uploadAttachment,
  findOrCreateActiveGroup,
  findActiveGroup,
  markGroupLeft,
  findGroupById,
  linkGroupToSpaceAtomic,
  findDigestTaskForVerification,
  markDigestTaskDoneAtomic,
  markDigestTaskDoneByGroupAndNumberAtomic,
  createInstantDigestTask,
  reopenDigestTaskAtomic,
  findIdentityIdsByExternalUserIds,
  backfillDigestAssigneeIdentity,
  findValidSharedGroupClaimCode,
  findOrCreatePendingGroupClaim,
  redeemCodeOnlyClaim,
  type SharedGroupClaimLinkCode,
  type LineAccount,
  type OrgLineAccount,
  type PlatformLineAccount,
  type InsertChannelMessageInput,
  type ValidLinkCode,
  type ChannelGroup,
  consumeUserLinkCode,
  expireUserLinkCode,
  promoteDigestTaskViaLine,
  rejectDigestTaskViaLine,
  claimApprovalNotification,
  clearApprovalNotifiedAt,
  getOrgChannelPolicyState,
  getPlatformBudgetState,
} from '@/lib/channels/store'
import { disableStaleGroupSinks } from '@/lib/sinks/store'
import { notifySinkDisabledForRelink } from '@/lib/sinks/notify'
import { notifyCodeOnlyGroupLinked } from '@/lib/channels/groupClaimNotify'
import { registerInvalidClaimAttemptAndCheckLimit } from '@/lib/channels/limboRateLimit'
import {
  pushLineMessage,
  fetchLineMessageContent,
  replyLineMessage,
  leaveRoom,
  fetchGroupMemberProfile,
  fetchGroupSummary,
} from '@/lib/channels/line/client'
import { verifyLineSignature } from '@/lib/channels/line/verify'
import {
  parseLineWebhookBody,
  normalizeLineEvent,
  type NormalizedLineEvent,
} from '@/lib/channels/line/events'
import { normalizeLinkCode, normalizeClaimCode } from '@/lib/channels/linkCode'
import { parseDigestCompleteCommand } from '@/lib/channels/digest/commands'
import {
  parseDigestDonePostback,
  parseDigestUndoPostback,
  parseDigestPromotePostback,
  parseDigestRejectPostback,
} from '@/lib/channels/digest/postback'
import {
  buildMentionTaskTitle,
  buildTaskDoneFlexMessage,
  buildTaskDetailLine,
  resolveAssignee,
  buildApprovalPromptFlexMessage,
  buildDigestRetryKey,
} from '@/lib/channels/digest/compute'
import { parseJapaneseDue } from '@/lib/channels/digest/due'
import { jstNow } from '@/lib/datetime/jstNow'
import { formatDateToLocalString } from '@/lib/gantt/dateUtils'
import { getJstDayOfYear } from '@/lib/channels/metering/decideAutoPush'
import { decideSharedSendBudget } from '@/lib/channels/metering/decideSharedSendBudget'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveOrgEntitlements } from '@/lib/billing/entitlements'

/**
 * LINE webhook のオーケストレーション。
 *
 * 順序厳守: 未検証ボディは destination 抽出以外に使わない。
 *   destination 抽出 → アカウント逆引き → アカウント別 secret で署名検証 → イベント処理
 *
 * LINE は非2xxを再送するため、処理不能なリクエストは 200 で無視する
 * （401は署名不正=正当な送信元でない場合のみ）。
 *
 * disabled アカウント: inbound の記録は続けるが、自動応答（挨拶・突合確認・消し込み確認）
 * とdigestは停止する（送信APIの409はStage 2コンソール側。ここでは扱わない）。
 *
 * 共有bot（owner_type='platform'・Stage 4）: account単体からorgを導けない
 * （org_id=NULL・複数orgで相乗り）。帰属は必ず channel_groups(group.orgId) から取り、
 * webhookはgroup行を作らない（承認RPCファミリ経由のみ）。1:1/roomはorg解決不能のため
 * 保存ゼロ＋定型案内reply、未承認グループ(limbo)も保存ゼロが原則（設計正本 §1/§3/§4）。
 */

export interface WebhookHandleResult {
  status: number
  body: Record<string, unknown>
}

/** 初回挨拶。AI名乗りと記録明示は §9 の固定文言 — 削らないこと（owner_type='org'専用bot向け） */
export function buildGreeting(accountDisplayName: string): string {
  return (
    `はじめまして。${accountDisplayName}の秘書AIアシスタントです。\n` +
    `資料のお預かりやご連絡をお手伝いします。\n` +
    `このトークでのやり取りは事務所の記録に残ります。\n\n` +
    `事務所からご案内している「確認コード」をお持ちの場合は、このトークにご返信ください。`
  )
}

function buildLinkConfirmation(accountDisplayName: string): string {
  return (
    `確認コードを受け付けました。ご登録ありがとうございます。\n` +
    `今後、${accountDisplayName}からのご連絡はこのトークにお送りします。`
  )
}

function buildGroupLinkConfirmation(accountDisplayName: string): string {
  return (
    `確認コードを受け付けました。ご登録ありがとうございます。\n` +
    `今後、${accountDisplayName}からのご連絡はこのグループにお送りします。`
  )
}

const ALREADY_DONE_TEXT = 'そのタスクは既に完了済みです。'

function buildTaskUndoReply(title: string): string {
  return `『${title}』をタスクに戻しました。`
}

const UNDO_FAILED_TEXT =
  '取り消せませんでした（完了から24時間以上経過、または既に戻されています）。コンソールからも戻せます。'

// 責任者確認（Stage 2.7-B）の 1:1 返信文言
const PROMOTE_DONE_TEXT = '承認しました。タスクに登録し、担当の画面に追加しました。'
const PROMOTE_ALREADY_TEXT = 'すでにタスク化済みです。'
const REJECT_DONE_TEXT = '却下しました。タスクには登録しません。'
const APPROVAL_CONFLICT_TEXT = 'この項目はすでに処理済みです。'

const APPROVAL_REQUESTED_TEXT = '責任者に確認をお願いしました。承認されると本体タスクになります。'
const MENTION_TITLE_EMPTY_TEXT =
  '内容が読み取れませんでした。メンションに続けてタスク内容をお書きください。'

/**
 * 完了reply（Stage 2.5 §3-1）: LINEグループメンバーのプロフィールを取得できれば記名する。
 * ベストエフォート（fetchGroupMemberProfileは失敗時null）のため、取得できなければ従来文言にフォールバックする。
 */
async function buildNamedDoneMessage(
  account: LineAccount,
  externalGroupId: string,
  externalUserId: string | null,
  title: string,
  taskId: string,
) {
  const profile = externalUserId
    ? await fetchGroupMemberProfile(account.accessToken, externalGroupId, externalUserId)
    : null
  return buildTaskDoneFlexMessage({ title, doneByDisplayName: profile?.displayName ?? null, taskId })
}

const LINK_CODE_FAILED_TEXT =
  '確認コードをお確かめのうえ、もう一度お送りください。ご不明な場合は事務所までご連絡ください。'

/**
 * 内部ユーザーの本人紐付け（Stage 2.7-A）への応答。
 * 失敗理由を必要以上に明かさない（総当たりの手掛かりを与えない）が、
 * 本人が自力で回復できる程度の情報は返す。
 */
const USER_LINK_REPLY: Record<string, string> = {
  ok: 'LINEアカウントを連携しました。承認の依頼はこのトークに届きます。',
  invalid: 'コードが無効です。管理画面で新しいコードを発行してお試しください。',
  expired: 'コードの有効期限が切れています。管理画面で新しいコードを発行してください。',
  locked: '試行回数が多すぎます。しばらく時間をおいてからお試しください。',
  conflict:
    'このLINEアカウントは既に別のユーザーに連携されています。管理画面で連携を解除してからお試しください。',
}

/** グループに誤って貼られた内部コードへの応答（コードは即時失効させる） */
const USER_LINK_LEAKED_TEXT =
  'このコードはグループでは使えません。安全のため無効化しました。管理画面で再発行し、秘書との1:1トークにお送りください。'

/** 失効対象が見つからなかった場合（既に使用済み・期限切れ等）。「無効化しました」と嘘をつかない */
const USER_LINK_LEAKED_UNKNOWN_TEXT =
  'このコードはグループでは使えません。秘書との1:1トークにお送りください。'

const ROOM_UNSUPPORTED_TEXT =
  '恐れ入りますが、複数人トークには対応しておりません。グループトークでご利用ください。'

/** 共有bot（platform）の1:1/follow応答。org解決不能のためidentityリンクは非対応（設計正本 §1・§7で将来対応） */
const SHARED_BOT_DIRECT_UNSUPPORTED_TEXT =
  '恐れ入りますが、個別のトークでのご相談は承っておりません。事務所からご案内された確認コードを、グループトークにご返信ください。'

/** 共有bot（platform）のグループjoin挨拶。承認完了まで記録されない旨を明示する（設計正本 §4） */
function buildSharedBotGroupGreeting(accountDisplayName: string): string {
  return (
    `はじめまして。${accountDisplayName}です。\n` +
    `事務所からご案内された確認コードを、このグループにご返信ください。\n` +
    `承認が完了するまで、このグループのやり取りは記録されません。`
  )
}

const SHARED_GROUP_CLAIM_INVALID_TEXT =
  'コードをお確かめのうえ、もう一度お送りください。ご不明な場合は事務所までご連絡ください。'

function buildSharedGroupClaimAcceptedText(challengeLabel: string): string {
  return (
    `確認コードを受け付けました。事務所の担当者が承認すると連携が完了します。\n` +
    `承認されるまで、このグループのやり取りは記録されません。\n` +
    `お問い合わせの際は確認番号「${challengeLabel}」をお伝えください。`
  )
}

/** code_only: 人の承認なしに即時成立（設計正本 §1/§4）。web_approvalの案内文とは別の固定文言 */
const CODE_ONLY_LINKED_TEXT =
  'このグループを登録しました。これ以降のやり取りを記録します。\nこのトークでのやり取りは事務所の記録に残ります。'

/** code_only: 別コードで既に登録済み（単回成功・マルチユース禁止・設計正本 §3） */
const CODE_ONLY_ALREADY_LINKED_TEXT = 'このグループは既に登録済みです。'

export async function handleLineWebhook(
  rawBody: string,
  signature: string | null,
): Promise<WebhookHandleResult> {
  const parsed = parseLineWebhookBody(rawBody)
  if (!parsed) {
    return { status: 200, body: { ignored: true } }
  }

  const account = await findLineAccountByDestination(parsed.destination)
  if (!account) {
    console.error('LINE webhook: unknown destination', parsed.destination)
    return { status: 200, body: { ignored: true } }
  }

  if (!verifyLineSignature(rawBody, signature, account.channelSecret)) {
    return { status: 401, body: { error: 'invalid signature' } }
  }

  for (const rawEvent of parsed.events) {
    const event = normalizeLineEvent(rawEvent)
    if (!event) continue
    try {
      await processEvent(account, event)
    } catch (error) {
      // 1イベントの失敗が他イベント・webhook全体(再送ループ)を巻き込まないよう握る
      console.error('LINE webhook: event processing failed', event.webhookEventId, error)
    }
  }

  return { status: 200, body: { ok: true } }
}

async function processEvent(account: LineAccount, event: NormalizedLineEvent): Promise<void> {
  const disabled = account.status === 'disabled'

  if (event.kind === 'room_join') {
    await processRoomJoin(account, event)
    return
  }
  if (event.kind === 'join') {
    await processGroupJoin(account, event, disabled)
    return
  }
  if (event.kind === 'leave') {
    await processGroupLeave(account, event)
    return
  }
  if (event.kind === 'postback') {
    await processPostback(account, event, disabled)
    return
  }
  if (event.kind === 'follow') {
    if (account.ownerType === 'platform') {
      // 共有bot1:1: org解決不能・identityリンク非対応（設計正本 §1・§7で将来対応）。保存ゼロ＋定型案内のみ
      if (!disabled) {
        await pushLineMessage({
          accessToken: account.accessToken,
          to: event.externalUserId!,
          messages: [{ type: 'text', text: SHARED_BOT_DIRECT_UNSUPPORTED_TEXT }],
        })
      }
      return
    }
    // webhook再送(dedupe)時は挨拶も再送しない
    const recorded = await recordSystemEvent(account, event, 'follow')
    if (recorded === 'duplicate' || disabled) return
    await sendSecretaryText(account, event.externalUserId!, buildGreeting(account.displayName), {
      relatedEventId: event.webhookEventId,
    })
    return
  }
  if (event.kind === 'unfollow') {
    if (account.ownerType === 'platform') return // 保存しない（org解決不能）
    await recordSystemEvent(account, event, 'unfollow')
    return
  }

  // message イベント
  if (event.groupId) {
    await processGroupMessage(account, event, disabled)
  } else {
    await processDirectMessage(account, event, disabled)
  }
}

// ---------------------------------------------------------------------------
// 1:1（既存Stage1のフロー。挙動は変更しない。disabled時は自動応答のみ停止）
// owner_type='platform'（共有bot）は org解決不能のため冒頭で分岐し、以降はorg専用botのみ
// ---------------------------------------------------------------------------

async function processDirectMessage(
  account: LineAccount,
  event: NormalizedLineEvent,
  disabled: boolean,
): Promise<void> {
  if (account.ownerType === 'platform') {
    await processPlatformDirectMessage(account, event, disabled)
    return
  }

  const externalUserId = event.externalUserId!
  const identities = await findActiveLineIdentities(account.orgId, externalUserId)

  // 内部ユーザーの本人紐付けコード（TA-...）は顧客用の突合コードより先に判定する。
  // 形式が異なるので取り違えは起きないが、判定順を固定しておく（Stage 2.7-A §3-4）
  if (event.contentType === 'text' && looksLikeUserLinkCode(event.body)) {
    await processUserLinkCode(account, event, disabled)
    return
  }

  if (event.contentType === 'text' && event.body) {
    const code = normalizeLinkCode(event.body)
    if (code) {
      const linkCode = await findValidLinkCode(code)
      // 他org（別事務所のOA）のコードは成立させない
      if (linkCode && linkCode.orgId === account.orgId) {
        await processLinkCode(account, event, linkCode, disabled)
        return
      }
      // 有効コードでない場合: 未突合ユーザーにだけ案内を返す。
      // リンク済みユーザーのコード形状テキスト（参照番号等）は通常メッセージとして
      // フォールスルーし、帰属を失わない
      if (identities.length === 0) {
        const recorded = await insertChannelMessage(inboundTextRecord(account, event, null, null))
        if (recorded !== 'duplicate' && !disabled) {
          await sendSecretaryText(account, externalUserId, LINK_CODE_FAILED_TEXT, {
            relatedEventId: event.webhookEventId,
          })
        }
        return
      }
    }
  }

  // 1件なら帰属確定。複数件（同一人物が複数顧問先の窓口）は人力トリアージに委ねてnull
  const { spaceId, identityId } =
    identities.length === 1
      ? { spaceId: identities[0].spaceId, identityId: identities[0].id }
      : { spaceId: null, identityId: null }

  let storagePath: string | null = null
  let status: InsertChannelMessageInput['status'] = 'received'
  let errorText: string | null = null

  if (event.contentType !== 'text') {
    // 添付はLINE側の取得期限で消えるため受信時に保存する（失敗はfailedで残しリトライ可能に）
    try {
      const content = await fetchLineMessageContent(account.accessToken, event.externalMessageId)
      storagePath = await uploadAttachment(
        account.orgId,
        event.externalMessageId,
        content.data,
        content.contentType,
      )
    } catch (error) {
      status = 'failed'
      errorText = error instanceof Error ? error.message : String(error)
    }
  }

  await insertChannelMessage({
    orgId: account.orgId,
    spaceId,
    identityId,
    accountId: account.id,
    groupId: null,
    channel: 'line',
    direction: 'inbound',
    actor: 'client',
    externalUserId,
    externalMessageId: event.externalMessageId,
    contentType: event.contentType,
    body: maskUserLinkCode(event.body),
    payload: event.payload,
    storagePath,
    status,
    error: errorText,
    occurredAt: event.occurredAt,
  })
}

/**
 * 共有bot（platform）の1:1。org解決不能のためidentityリンクは非対応（設計正本 §1・将来対応は§7）。
 * 内部ユーザーのTA-コードもここでは処理しない（発行APIがorg専用botのみを対象にしており、
 * platform account宛の有効な行は現状存在し得ないため。§7「共有bot 1:1の将来対応」で扱う）。
 */
async function processPlatformDirectMessage(
  account: PlatformLineAccount,
  event: NormalizedLineEvent,
  disabled: boolean,
): Promise<void> {
  if (disabled || !event.replyToken) return
  await replyLineMessage({
    accessToken: account.accessToken,
    replyToken: event.replyToken,
    messages: [{ type: 'text', text: SHARED_BOT_DIRECT_UNSUPPORTED_TEXT }],
  })
}

/**
 * 内部ユーザーの本人紐付け（Stage 2.7-A）。1:1トークでのみ受理する。owner_type='org'専用bot限定。
 *
 * 記録は必ず先に行う（inboundTextRecord がコードをマスクするので、平文はDBに残らない）。
 * RPC は例外を投げず status で返す — 例外だと同一トランザクション内の試行履歴も
 * ロールバックされ、総当たり対策が機能しなくなるため。
 */
async function processUserLinkCode(
  account: OrgLineAccount,
  event: NormalizedLineEvent,
  disabled: boolean,
): Promise<void> {
  const externalUserId = event.externalUserId!
  const recorded = await insertChannelMessage(inboundTextRecord(account, event, null, null))

  // 本文全体ではなく *抽出したコード* をハッシュする。
  // 「このコードです TA-xxx よろしく」のように前後に文章が付いていても成立させる
  const code = extractUserLinkCode(event.body)
  const { status } = code
    ? await consumeUserLinkCode(hashUserLinkCode(code), account.id, externalUserId)
    : ({ status: 'invalid' } as const)

  // webhook再送(dedupe)時は応答を再送しない。disabled中は自動応答を止める
  if (recorded === 'duplicate' || disabled) return

  await sendSecretaryText(account, externalUserId, USER_LINK_REPLY[status], {
    relatedEventId: event.webhookEventId,
  })
}

async function processLinkCode(
  account: OrgLineAccount,
  event: NormalizedLineEvent,
  linkCode: ValidLinkCode,
  disabled: boolean,
): Promise<void> {
  // linkIdentityViaCode は冪等（既にactiveなら既存を返す）
  const identity = await linkIdentityViaCode(linkCode, event.externalUserId!)

  // 友だち追加前にメンションされた申し送りを人へ昇格する（Stage 2.6 §6）。
  // バックフィルの失敗で紐付け自体を失敗させない（名前ラベルのままでも運用は成立する）
  try {
    await backfillDigestAssigneeIdentity(identity.id)
  } catch (error) {
    console.error('[line-webhook] digest assignee backfill failed', error)
  }

  const recorded = await insertChannelMessage(
    inboundTextRecord(account, event, identity.spaceId, identity.id),
  )
  // webhook再送(dedupe)時は確認返信も再送しない。disabled中は自動応答を止める
  if (recorded === 'duplicate' || disabled) return
  await sendSecretaryText(
    account,
    event.externalUserId!,
    buildLinkConfirmation(account.displayName),
    { spaceId: identity.spaceId, identityId: identity.id, relatedEventId: event.webhookEventId },
  )
}

function inboundTextRecord(
  account: OrgLineAccount,
  event: NormalizedLineEvent,
  spaceId: string | null,
  identityId: string | null,
): InsertChannelMessageInput {
  return {
    orgId: account.orgId,
    spaceId,
    identityId,
    accountId: account.id,
    groupId: event.groupId ?? null,
    channel: 'line',
    direction: 'inbound',
    actor: 'client',
    externalUserId: event.externalUserId,
    externalMessageId: event.externalMessageId,
    contentType: 'text',
    body: maskUserLinkCode(event.body),
    payload: event.payload,
    storagePath: null,
    status: 'received',
    error: null,
    occurredAt: event.occurredAt,
  }
}

async function recordSystemEvent(
  account: OrgLineAccount,
  event: NormalizedLineEvent,
  eventName: string,
): Promise<{ id: string } | 'duplicate'> {
  return insertChannelMessage({
    orgId: account.orgId,
    spaceId: null,
    identityId: null,
    accountId: account.id,
    groupId: event.groupId ?? null,
    channel: 'line',
    direction: 'inbound',
    actor: 'system',
    externalUserId: event.externalUserId,
    externalMessageId: event.externalMessageId,
    contentType: 'system',
    body: null,
    payload: { event: eventName },
    storagePath: null,
    status: 'received',
    error: null,
    occurredAt: event.occurredAt,
  })
}

async function sendSecretaryText(
  account: OrgLineAccount,
  to: string,
  text: string,
  opts: { spaceId?: string | null; identityId?: string | null; relatedEventId: string },
): Promise<void> {
  await pushLineMessage({
    accessToken: account.accessToken,
    to,
    messages: [{ type: 'text', text }],
  })
  await insertChannelMessage({
    orgId: account.orgId,
    spaceId: opts.spaceId ?? null,
    identityId: opts.identityId ?? null,
    accountId: account.id,
    groupId: null,
    channel: 'line',
    direction: 'outbound',
    actor: 'secretary',
    externalUserId: to,
    externalMessageId: null,
    contentType: 'text',
    body: text,
    payload: { autoReplyTo: opts.relatedEventId },
    storagePath: null,
    status: 'sent',
    error: null,
    occurredAt: new Date().toISOString(),
    // sendSecretaryText は常に pushLineMessage 配信（1:1自動応答）。reply分岐は無い
    billablePush: true,
  })
}

// ---------------------------------------------------------------------------
// グループ（Stage 2b。Stage 4以降は帰属を常に group.orgId から取る — account.orgIdは
// owner_type='platform'ではnullであり、グループ文脈で参照してはならない）
// ---------------------------------------------------------------------------

function groupMessageRecord(
  orgId: string,
  accountId: string,
  event: NormalizedLineEvent,
  group: ChannelGroup | null,
  identityId: string | null,
  storagePath: string | null,
  status: InsertChannelMessageInput['status'] = 'received',
  errorText: string | null = null,
): InsertChannelMessageInput {
  return {
    orgId,
    // グループ発言のspace_idは常にグループ由来のみ（identity自動帰属は絶対に適用しない）
    spaceId: group?.spaceId ?? null,
    identityId,
    accountId,
    groupId: group?.id ?? null,
    channel: 'line',
    direction: 'inbound',
    actor: 'client',
    externalUserId: event.externalUserId,
    externalMessageId: event.externalMessageId,
    contentType: event.contentType,
    body: maskUserLinkCode(event.body),
    payload: event.payload,
    storagePath,
    status,
    error: errorText,
    occurredAt: event.occurredAt,
  }
}

async function processGroupJoin(
  account: LineAccount,
  event: NormalizedLineEvent,
  disabled: boolean,
): Promise<void> {
  const externalGroupId = event.groupId!

  if (account.ownerType === 'platform') {
    // 共有bot: webhookからgroup行を作らない（承認RPCファミリ経由のみ・設計正本 §3）。
    // 会話は保存せず、承認完了まで記録されない旨を明示した挨拶のみ送る（§4）。
    if (!disabled) {
      await pushLineMessage({
        accessToken: account.accessToken,
        to: externalGroupId,
        messages: [{ type: 'text', text: buildSharedBotGroupGreeting(account.displayName) }],
      })
    }
    return
  }

  const group = await findOrCreateActiveGroup({
    orgId: account.orgId,
    accountId: account.id,
    externalGroupId,
    displayName: null,
  })

  const recorded = await insertChannelMessage({
    orgId: account.orgId,
    spaceId: group.spaceId,
    identityId: null,
    accountId: account.id,
    groupId: group.id,
    channel: 'line',
    direction: 'inbound',
    actor: 'system',
    externalUserId: null,
    externalMessageId: event.webhookEventId,
    contentType: 'system',
    body: null,
    payload: { event: 'join' },
    storagePath: null,
    status: 'received',
    error: null,
    occurredAt: event.occurredAt,
  })

  // webhook再送(dedupe)時は挨拶を再送しない。disabled中は記録のみ
  if (recorded === 'duplicate' || disabled) return

  const greeting = buildGreeting(account.displayName)
  await pushLineMessage({
    accessToken: account.accessToken,
    to: externalGroupId,
    messages: [{ type: 'text', text: greeting }],
  })
  await insertChannelMessage({
    orgId: account.orgId,
    spaceId: group.spaceId,
    identityId: null,
    accountId: account.id,
    groupId: group.id,
    channel: 'line',
    direction: 'outbound',
    actor: 'secretary',
    externalUserId: null,
    externalMessageId: null,
    contentType: 'text',
    body: greeting,
    payload: { autoReplyTo: event.webhookEventId },
    storagePath: null,
    status: 'sent',
    error: null,
    occurredAt: new Date().toISOString(),
    // join挨拶は常に pushLineMessage 配信（グループjoinイベントにreplyTokenは無い）
    billablePush: true,
  })
}

async function processGroupLeave(account: LineAccount, event: NormalizedLineEvent): Promise<void> {
  const externalGroupId = event.groupId!
  const group = await findActiveGroup(account.id, externalGroupId)
  await markGroupLeft(account.id, externalGroupId)

  if (!group) {
    if (account.ownerType === 'platform') return // 未承認(limbo)のまま退出。保存しない
    await insertChannelMessage({
      orgId: account.orgId,
      spaceId: null,
      identityId: null,
      accountId: account.id,
      groupId: null,
      channel: 'line',
      direction: 'inbound',
      actor: 'system',
      externalUserId: null,
      externalMessageId: event.webhookEventId,
      contentType: 'system',
      body: null,
      payload: { event: 'leave' },
      storagePath: null,
      status: 'received',
      error: null,
      occurredAt: event.occurredAt,
    })
    return
  }

  await insertChannelMessage({
    orgId: group.orgId,
    spaceId: group.spaceId,
    identityId: null,
    accountId: account.id,
    groupId: group.id,
    channel: 'line',
    direction: 'inbound',
    actor: 'system',
    externalUserId: null,
    externalMessageId: event.webhookEventId,
    contentType: 'system',
    body: null,
    payload: { event: 'leave' },
    storagePath: null,
    status: 'received',
    error: null,
    occurredAt: event.occurredAt,
  })
}

/**
 * room（複数人トーク）は非サポート。案内を送って退出する。
 * disabled状態でも実施する（rooms自体が機能として非対応のため、bot有効/無効とは独立）。
 * owner_type='platform'はorgを解決できないため記録しない（fail-closed。org_idはNOT NULL）。
 */
async function processRoomJoin(account: LineAccount, event: NormalizedLineEvent): Promise<void> {
  const roomId = event.roomId!
  let recorded: { id: string } | 'duplicate' | null = null
  if (account.ownerType !== 'platform') {
    recorded = await insertChannelMessage({
      orgId: account.orgId,
      spaceId: null,
      identityId: null,
      accountId: account.id,
      groupId: null,
      channel: 'line',
      direction: 'inbound',
      actor: 'system',
      externalUserId: null,
      externalMessageId: event.webhookEventId,
      contentType: 'system',
      body: null,
      payload: { event: 'room_join', roomId },
      storagePath: null,
      status: 'received',
      error: null,
      occurredAt: event.occurredAt,
    })
  }
  if (recorded === 'duplicate') return

  try {
    if (event.replyToken) {
      await replyLineMessage({
        accessToken: account.accessToken,
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: ROOM_UNSUPPORTED_TEXT }],
      })
    } else {
      await pushLineMessage({
        accessToken: account.accessToken,
        to: roomId,
        messages: [{ type: 'text', text: ROOM_UNSUPPORTED_TEXT }],
      })
    }
  } catch (error) {
    console.error('LINE webhook: room guidance failed', roomId, error)
  }

  try {
    await leaveRoom(account.accessToken, roomId)
  } catch (error) {
    console.error('LINE webhook: room leave failed', roomId, error)
  }
}

async function processGroupMessage(
  account: LineAccount,
  event: NormalizedLineEvent,
  disabled: boolean,
): Promise<void> {
  const externalGroupId = event.groupId!
  const group = await findActiveGroup(account.id, externalGroupId)

  // 内部ユーザーの本人紐付けコードがグループに貼られた（誤爆）。owner_type非依存の安全策
  // （テナントが未確定なlimboグループでも常に失効させる）。
  // グループの全員がそれを読めてしまうため、紐付けは *成立させず* コードを即時失効させる。
  // 本文は groupMessageRecord がマスクするので、会話ログにも平文は残らない。
  const leakedCode = event.contentType === 'text' ? extractUserLinkCode(event.body) : null
  if (leakedCode) {
    const expired = await expireUserLinkCode(hashUserLinkCode(leakedCode))
    const recordOrgId = group?.orgId ?? (account.ownerType === 'platform' ? null : account.orgId)

    if (recordOrgId) {
      const recorded = await insertChannelMessage(
        groupMessageRecord(recordOrgId, account.id, event, group, null, null),
      )
      if (recorded !== 'duplicate' && !disabled) {
        await replyLineMessage({
          accessToken: account.accessToken,
          replyToken: event.replyToken!,
          // 失効できていないのに「無効化しました」と断言しない
          messages: [{ type: 'text', text: expired ? USER_LINK_LEAKED_TEXT : USER_LINK_LEAKED_UNKNOWN_TEXT }],
        })
      }
      return
    }

    // 共有bot(platform)のlimbo: 帰属org不明のため記録は0行（設計正本 §8(d)）。
    // 安全のため失効とreplyは行う（グループ全員に見える漏洩コードを放置しない）
    if (!disabled) {
      await replyLineMessage({
        accessToken: account.accessToken,
        replyToken: event.replyToken!,
        messages: [{ type: 'text', text: expired ? USER_LINK_LEAKED_TEXT : USER_LINK_LEAKED_UNKNOWN_TEXT }],
      })
    }
    return
  }

  if (!group) {
    if (account.ownerType === 'platform') {
      await processPlatformLimboGroupMessage(account, event, externalGroupId, disabled)
      return
    }
    // 万一activeな世代が無い場合（join取りこぼし等）。帰属無しで記録だけ行う
    await insertChannelMessage(groupMessageRecord(account.orgId, account.id, event, null, null, null))
    return
  }

  // 以降 group 確定。owner_typeに関わらず帰属は常に group.orgId 起点（設計正本 §1 絶対規約）
  const identityId = event.externalUserId
    ? (
        await findIdentityIdsByExternalUserIds(group.orgId, group.spaceId, [event.externalUserId])
      ).get(event.externalUserId) ?? null
    : null

  if (event.contentType === 'text' && event.body) {
    const digestNumber = parseDigestCompleteCommand(event.body)
    if (digestNumber !== null) {
      await handleDigestCompleteCommand(account, event, group, identityId, digestNumber, disabled)
      return
    }

    // 既に紐付け済みグループへのコード形状テキストは通常メッセージ扱い（帰属を保つ）。
    // 共有bot(platform)のactiveグループは作成時点でspace_idが確定済み(A-1トリガー)のため、
    // この分岐は構造的にowner_type='org'のみで到達する
    if (group.spaceId === null) {
      const code = normalizeLinkCode(event.body)
      if (code) {
        const linkCode = await findValidLinkCode(code)
        if (linkCode && linkCode.orgId === group.orgId) {
          await processGroupLinkCode(account, event, group, linkCode, identityId, disabled)
          return
        }
      }
    }

    // メンション即時タスク化（Stage 2.5 §2 / フェーズ2 §all_plus_instant）:
    // mention_only（無料）または all_plus_instant（pro以上限定・実行時ゲート）のみ。
    // 素の all は夜間抽出のみで拾うため経路を分ける
    // （同じsource_message_idでtitleが異なると unique 制約をすり抜けて二重登録になる）。
    // PC版LINEは本物メンションを付与できないため、非メンション合図（先頭一致）も同じ経路に乗せる。
    if (group.pickupMode === 'mention_only' || group.pickupMode === 'all_plus_instant') {
      // 本物メンション時は selfMentionSpans が既に同じ区間をカバーするため、
      // 二重除去を避けるためキーワード判定は本物メンションが無いときだけ行う
      const keywordSpan =
        !event.mentionsSelf && event.contentType === 'text' ? matchInstantTaskKeyword(event.body ?? '') : null
      if (event.mentionsSelf || keywordSpan) {
        // all_plus_instant は実行時ゲート（二重防御）: 非entitled org は即時化せず
        // 通常の記録パスへフォールスルーする（＝all相当に縮退。夜間抽出だけは動く）。
        // 設定値(pickup_mode)自体は書き換えない。
        const instantAllowed =
          group.pickupMode === 'mention_only' || (await hasDualModeInstantEntitlement(group.orgId))
        if (instantAllowed) {
          await handleMentionInstantTask(account, event, group, identityId, disabled, keywordSpan)
          return
        }
      }
    }
  }

  let storagePath: string | null = null
  let status: InsertChannelMessageInput['status'] = 'received'
  let errorText: string | null = null

  if (event.contentType !== 'text') {
    try {
      const content = await fetchLineMessageContent(account.accessToken, event.externalMessageId)
      storagePath = await uploadAttachment(
        group.orgId,
        event.externalMessageId,
        content.data,
        content.contentType,
      )
    } catch (error) {
      status = 'failed'
      errorText = error instanceof Error ? error.message : String(error)
    }
  }

  await insertChannelMessage(
    groupMessageRecord(group.orgId, account.id, event, group, identityId, storagePath, status, errorText),
  )
}

/**
 * 共有bot（platform）の未承認グループ（limbo）でのメッセージ処理
 * （設計正本 §1・§3・§4・§7-8・PR2/PR3b）。
 *
 * 通常の発言/添付/postbackは保存しない・取得しない・抽出しない。唯一の例外は紐付けコード投入:
 *   web_approval → claim登録＋チャレンジ返信（承認RPCでのgroup作成自体はコンソールUIから）
 *   code_only    → rpc_redeem_code_only_claim を1回呼び、人の承認なしに即時成立
 * いずれもwebhookはgroup行を直接作らない（web_approvalの成立は承認RPC・code_onlyは
 * rpc_redeem_code_only_claim内で原子的に作られる）。
 *
 * ★受理フィルタは shared_group_claim 専用の normalizeClaimCode（26文字正準形。Fable裁定・
 * 確定形状）を使う。顧問先突合コード(normalizeLinkCode・8文字・identity/group_link経路)とは
 * 別物で、そちらはこの関数の対象外（processDirectMessage/processGroupMessage側で無変更）。
 *
 * 応答は必ず次のいずれかに畳む（分岐を増やさない）:
 *   (1) normalizeClaimCode が null（26文字コード形状ですらない通常発言）→ 沈黙（無反応・無保存）
 *   (2) 26文字形状だがマッチした無効コード／コード不一致（rejected）→ 単一の固定文言
 *       （理由を一切開示しない。§3: 存在/期限/orgを推測させない）。§7-8: この(2)のみを
 *       グループ単位でレート制限し、上限超過後は完全に無応答化する（content-free）。
 *   (3) web_approval有効（pending化できた）→ claim登録＋チャレンジ番号入りの案内
 *   (4) code_only有効（即時成立）→ 成立文言（＋org通知をベストエフォートでトリガー）
 *   (5) code_only既に別コードで登録済み → 既登録文言
 *
 * ★disabled 凍結（Fable裁定 §6）: account.status='disabled' は「活性化(Step6)以前への回帰＝
 *   新規テナント確立の凍結」を意味し、それは「拒否」ではなく「不作為」。他の経路（挨拶・突合確認等）
 *   のように「記録はする・replyだけ止める」パターンとは異なり、この関数（新規テナント確立の唯一の
 *   入口）はコードを一切消費せず・claims/limbo系のメタも一切書かない。よって normalizeClaimCode 呼び出し
 *   より前、関数の入口で早期returnする（DB層 rpc_redeem_code_only_claim / rpc_approve_group_claim の
 *   status='active' チェックは多重防御。20260716122144_shared_bot_disabled_freeze_rpc.sql 参照）。
 */
async function processPlatformLimboGroupMessage(
  account: PlatformLineAccount,
  event: NormalizedLineEvent,
  externalGroupId: string,
  disabled: boolean,
): Promise<void> {
  // Fable §6: disabled = freeze (inaction) — no code consumption, no claims/limbo writes.
  if (disabled) return

  if (event.contentType !== 'text' || !event.body) return // 保存しない・反応しない

  // (1) 26文字コード形状ですらない通常発言は完全に沈黙する（無反応・無保存）
  const code = normalizeClaimCode(event.body)
  if (!code) return

  // (2)-(5) はredeemSharedGroupClaimCode内で1本の固定文言／案内応答に畳む
  const replyText = await redeemSharedGroupClaimCode(account, externalGroupId, code)

  // §7-8: マッチ無効/コード不一致の投入のみカウントする（正規の成立はカウントしない）
  if (replyText === SHARED_GROUP_CLAIM_INVALID_TEXT) {
    const limited = registerInvalidClaimAttemptAndCheckLimit(account.id, externalGroupId)
    if (limited) return // 上限超過後は完全な無応答化（content-free）
  }

  if (!event.replyToken) return
  await replyLineMessage({
    accessToken: account.accessToken,
    replyToken: event.replyToken,
    messages: [{ type: 'text', text: replyText }],
  })
}

/**
 * @param canonicalCode normalizeClaimCode() が返した26文字正準形。
 */
async function redeemSharedGroupClaimCode(
  account: PlatformLineAccount,
  externalGroupId: string,
  canonicalCode: string,
): Promise<string> {
  const codeHash = hashSharedGroupClaimCode(canonicalCode)
  const linkCode = await findValidSharedGroupClaimCode(codeHash, account.id)
  if (!linkCode) {
    // (2) 見つからない/期限切れ/消費済み/対象account不一致は同一バイト列の固定文言にする
    // （設計正本 §3: コード不正時の応答を統一。存在/期限/orgを推測させない）
    return SHARED_GROUP_CLAIM_INVALID_TEXT
  }

  // ベストエフォート: 取得できなくても紐付け処理自体は止めない（content-freeな確認材料に過ぎない）
  const summary = await fetchGroupSummary(account.accessToken, externalGroupId)
  const groupDisplayName = summary?.groupName ?? null

  if (linkCode.bindingMode === 'code_only') {
    return redeemCodeOnlySharedGroupClaim(account, linkCode, codeHash, externalGroupId, groupDisplayName)
  }

  const challengeLabel = generateGroupClaimChallengeLabel()
  const claim = await findOrCreatePendingGroupClaim({
    linkCodeId: linkCode.id,
    accountId: account.id,
    externalGroupId,
    orgId: linkCode.orgId,
    spaceId: linkCode.spaceId,
    challengeLabel,
    groupDisplayNameSnapshot: groupDisplayName,
  })

  // webhook再送で既存pendingが返った場合は、その既存challengeLabelを案内する
  return buildSharedGroupClaimAcceptedText(claim.challengeLabel ?? challengeLabel)
}

/**
 * code_only の即時償還（設計正本 §1/§3/§4・PR3b）。人の承認を経ず、rpc_redeem_code_only_claim
 * を1回呼ぶだけで成立する。webhookはgroup行を直接作らない（RPC内で原子的に作られる）。
 *
 * 応答は3値に畳む:
 *   linked         → 成功文言（このグループ以降のやり取りを記録する旨）＋org成立通知(ベストエフォート)
 *   already_linked → 別コードで既に登録済み文言（マルチユース禁止・単回成功）
 *   rejected       → web_approvalの無効コードと同一の固定文言（存在/理由を推測させない。
 *                     GC404のnot-foundもRPCラッパ側でrejectedに畳まれている）
 */
async function redeemCodeOnlySharedGroupClaim(
  account: PlatformLineAccount,
  linkCode: SharedGroupClaimLinkCode,
  codeHash: string,
  externalGroupId: string,
  groupDisplayName: string | null,
): Promise<string> {
  const result = await redeemCodeOnlyClaim(codeHash, account.id, externalGroupId, groupDisplayName)

  if (result === 'linked') {
    // ベストエフォート: 通知失敗は紐付け自体を巻き戻さない（設計正本 §4 成立通知は検知的統制）
    notifyCodeOnlyGroupLinked(linkCode.orgId, linkCode.spaceId, groupDisplayName).catch((error) => {
      console.error('LINE webhook: code_only linked notification failed', linkCode.orgId, error)
    })
    return CODE_ONLY_LINKED_TEXT
  }
  if (result === 'already_linked') {
    return CODE_ONLY_ALREADY_LINKED_TEXT
  }
  return SHARED_GROUP_CLAIM_INVALID_TEXT
}

async function processGroupLinkCode(
  account: LineAccount,
  event: NormalizedLineEvent,
  group: ChannelGroup,
  linkCode: ValidLinkCode,
  identityId: string | null,
  disabled: boolean,
): Promise<void> {
  // 紐付け＋バックフィル（過去メッセージ・openタスク）は同一トランザクションのRPCで原子化
  const linked = await linkGroupToSpaceAtomic(group.id, linkCode.spaceId)
  let currentGroup: ChannelGroup = group
  if (linked) {
    currentGroup = { ...group, spaceId: linkCode.spaceId }
    // AC12(docs/spec/AI_SECRETARY_STAGE3_INTEGRATIONS.md §10): 新世代への紐付けが
    // 成立した＝再リンクの可能性がある。旧世代向けsinkを無効化し通知する。
    // ベストエフォート: 失敗してもreply確認等の主フローは継続する。
    try {
      const disabledSinks = await disableStaleGroupSinks(group.id)
      await Promise.all(
        disabledSinks.map((sink) =>
          notifySinkDisabledForRelink(sink.sinkId, sink.orgId, sink.displayName),
        ),
      )
    } catch (error) {
      console.error('processGroupLinkCode: disableStaleGroupSinks failed', error)
    }
  } else {
    // レース: 既に他方が紐付け済み。現在値を再取得して整合させる
    currentGroup = (await findGroupById(group.id)) ?? group
  }

  // 紐付け前は space 未確定で identity を解決できなかった（他顧問先のidentityを引かないため null）。
  // ここでは space が確定しているので、このメッセージだけ発言者帰属が欠落しないよう再解決する
  const resolvedIdentityId =
    identityId ??
    (event.externalUserId
      ? (
          await findIdentityIdsByExternalUserIds(group.orgId, currentGroup.spaceId, [
            event.externalUserId,
          ])
        ).get(event.externalUserId) ?? null
      : null)

  const recorded = await insertChannelMessage(
    groupMessageRecord(currentGroup.orgId, account.id, event, currentGroup, resolvedIdentityId, null),
  )
  if (recorded === 'duplicate' || disabled) return

  const confirmation = buildGroupLinkConfirmation(account.displayName)
  if (event.replyToken) {
    await replyLineMessage({
      accessToken: account.accessToken,
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: confirmation }],
    })
  } else {
    await pushLineMessage({
      accessToken: account.accessToken,
      to: event.groupId!,
      messages: [{ type: 'text', text: confirmation }],
    })
  }
  await insertChannelMessage({
    orgId: currentGroup.orgId,
    spaceId: currentGroup.spaceId,
    identityId: null,
    accountId: account.id,
    groupId: group.id,
    channel: 'line',
    direction: 'outbound',
    actor: 'secretary',
    externalUserId: null,
    externalMessageId: null,
    contentType: 'text',
    body: confirmation,
    payload: { autoReplyTo: event.webhookEventId },
    storagePath: null,
    status: 'sent',
    error: null,
    occurredAt: new Date().toISOString(),
    // replyToken有り→replyLineMessage配信（無料枠を消費しない）/ 無し→pushLineMessage配信
    billablePush: !event.replyToken,
  })
}

async function handleDigestCompleteCommand(
  account: LineAccount,
  event: NormalizedLineEvent,
  group: ChannelGroup,
  identityId: string | null,
  digestNumber: number,
  disabled: boolean,
): Promise<void> {
  // 「完了N」テキスト自体も通常の発言としてまず記録する（監査ログ）
  const recorded = await insertChannelMessage(
    groupMessageRecord(group.orgId, account.id, event, group, identityId, null),
  )
  if (recorded === 'duplicate' || disabled) return

  const result = await markDigestTaskDoneByGroupAndNumberAtomic(
    group.id,
    digestNumber,
    event.externalUserId ?? null,
  )

  // 記名Flex（Stage 2.5 §3-1）: 完了できた場合のみ。マッチしない場合は従来どおりテキスト
  const replyMessage = result
    ? await buildNamedDoneMessage(account, group.externalGroupId, event.externalUserId, result.title, result.id)
    : ({ type: 'text' as const, text: ALREADY_DONE_TEXT })
  const replyBodyForRecord = replyMessage.type === 'text' ? replyMessage.text : replyMessage.altText

  if (event.replyToken) {
    await replyLineMessage({
      accessToken: account.accessToken,
      replyToken: event.replyToken,
      messages: [replyMessage],
    })
  }
  await insertChannelMessage({
    orgId: group.orgId,
    spaceId: group.spaceId,
    identityId: null,
    accountId: account.id,
    groupId: group.id,
    channel: 'line',
    direction: 'outbound',
    actor: 'secretary',
    externalUserId: null,
    externalMessageId: null,
    contentType: 'text',
    body: replyBodyForRecord,
    payload: { autoReplyTo: event.webhookEventId },
    storagePath: null,
    status: event.replyToken ? 'sent' : 'failed',
    error: event.replyToken ? null : 'no replyToken',
    occurredAt: new Date().toISOString(),
  })
}

/**
 * 非メンションの即時タスク化合図（PC版LINE対応）。PCのLINEはbotへの本物メンションを
 * 付与できない（`@名前`は単なる文字列になり mention 情報が乗らない）ため、本文先頭が
 * この合図で始まる場合も本物メンションと同様に即時タスク化する。
 * 誤爆防止のため「先頭」限定（文中の言及では発火しない）。
 */
const INSTANT_TASK_KEYWORDS = ['@秘書', 'タスク追加'] as const

function matchInstantTaskKeyword(body: string): { index: number; length: number } | null {
  const leadingWs = body.length - body.trimStart().length
  const rest = body.slice(leadingWs)
  for (const kw of INSTANT_TASK_KEYWORDS) {
    if (rest.startsWith(kw)) return { index: 0, length: leadingWs + kw.length }
  }
  return null
}

/**
 * all_plus_instant（フェーズ2・pro以上限定）の実行時ゲート。設定APIの403に加えた二重防御。
 *
 * ゲートするfeatureは instant_line_notify（即時性そのもの）。line_pickup_dual_mode（自動タスク拾い
 * 自体）は事業判断(2026-07・commit ce0e733)でFreeにも開放済みのため、これをここで見ると
 * Freeでも即時化してしまう回帰になる（差別化は「拾い」ではなく「即時性」で行う設計）。
 *
 * fail-closed: entitlement解決に失敗しても例外は投げず、即時化しない側に倒す
 * （resolveOrgEntitlements自体は例外を投げない設計だが、createAdminClient()の設定不備等の
 * 想定外にも備えて握る）。
 */
async function hasDualModeInstantEntitlement(orgId: string): Promise<boolean> {
  try {
    const entitlements = await resolveOrgEntitlements(createAdminClient(), orgId)
    return entitlements.has('instant_line_notify')
  } catch (error) {
    console.error('hasDualModeInstantEntitlement: resolution failed, defaulting to false', error)
    return false
  }
}

/**
 * メンション即時タスク化（Stage 2.5 §2）: mention_only グループでbot宛メンション、
 * または非メンション合図（`matchInstantTaskKeyword`。PC版LINE対応）を検知した際のパス。
 * disabled中は記録のみで終了する（digest系の自動動作はdisabledで停止、の既存原則に従う）。
 */
async function handleMentionInstantTask(
  account: LineAccount,
  event: NormalizedLineEvent,
  group: ChannelGroup,
  identityId: string | null,
  disabled: boolean,
  keywordSpan?: { index: number; length: number } | null,
): Promise<void> {
  const recorded = await insertChannelMessage(
    groupMessageRecord(group.orgId, account.id, event, group, identityId, null),
  )
  if (recorded === 'duplicate') return
  if (disabled) return

  const body = event.body ?? ''
  // 秘書宛メンション・担当者宛メンションに加えて、非メンション合図（PC版LINE対応）も
  // タイトルから除去する（担当は assignee_hint に別で持つため、タイトルに '@山田' を残さない）
  const mentionSpans = [
    ...(event.selfMentionSpans ?? []),
    ...(event.assigneeMentions ?? []),
    ...(keywordSpan ? [keywordSpan] : []),
  ]
  const title = buildMentionTaskTitle(body, mentionSpans)

  let replyText: string
  if (!title) {
    replyText = MENTION_TITLE_EMPTY_TEXT
  } else {
    // 期限は本文（メンション除去前）から解決する。titleは50字で切り詰められるため、
    // 末尾の期限表現がタイトルから落ちていても本文には残っている
    const now = jstNow()
    const due = parseJapaneseDue(body, now)
    // 即時パスはLLMを通さない（即応性を優先）。担当はメンションだけから決める
    const assignee = resolveAssignee(event.assigneeMentions, null)

    let assigneeIdentityId: string | null = null
    if (assignee.assigneeExternalUserId) {
      // 必ずこのグループの space で解決する（他顧問先のidentityを引かない）
      const identities = await findIdentityIdsByExternalUserIds(group.orgId, group.spaceId, [
        assignee.assigneeExternalUserId,
      ])
      assigneeIdentityId = identities.get(assignee.assigneeExternalUserId) ?? null
    }

    // 承認フロー（Stage 2.7-B §4-5）: 候補作成はグループ行を FOR UPDATE でロックする RPC に一元化する。
    // pending 判定（責任者設定済み *かつ* space 紐付け済み）は *ロックした行* から DB 側で確定するため、
    // 取得〜作成の隙間に rpc_set_group_approver で承認者が変わっても、旧承認者宛の宙吊り pending は
    // 生まれない（承認者変更と直列化される）。アプリは承認者を渡さない。
    const created = await createInstantDigestTask({
      groupId: group.id,
      sourceMessageId: recorded.id,
      title,
      assigneeHint: assignee.assigneeHint,
      assigneeExternalUserId: assignee.assigneeExternalUserId,
      assigneeIdentityId,
      dueDate: due.dueDate,
      dueTime: due.dueTime,
    })

    if (created.pending) {
      // 承認フローに乗った。新規作成（重複でない）なら責任者の 1:1 へ確認Flexを試みる。
      // 候補は既に pending で残るため、claim/push が失敗しても cron／コンソールが確実に拾う（取りこぼし防止）。
      if (!created.duplicate && created.id) {
        const taskId = created.id
        try {
          // 送信境界の縮退判定。claimより前に判定し、抑止なら
          // claimもpushも一切行わない（候補はpendingのまま残り、cron／コンソールが拾う）。
          // cron版(approval-notify)と同じ判定を即時1:1送信にも適用する（非対称の解消）。
          // org層(policy)＋グローバル予算層(共有bot account軸の実物理上限)の二層判定（fable確定設計）。
          // 専用bot(owner_type='org')は顧客側の枠であり当社の持ち出しではないため常に'ok'扱い。
          const policy = await getOrgChannelPolicyState(group.orgId)
          const globalState =
            account.ownerType === 'platform' ? await getPlatformBudgetState(account.id) : 'ok'
          const decision = decideSharedSendBudget({
            org: { state: policy.state, onExceed: policy.onExceed },
            global: { state: globalState },
            jstDayOfYear: getJstDayOfYear(),
          })

          if (!decision.deliver) {
            console.log(
              `[handleMentionInstantTask] approval push suppressed (task ${taskId}): ${decision.reason}`,
            )
          } else {
            // 原子的 claim: 責任者が *現在も* 承認権限を持ち有効な1:1紐付けがある場合だけ
            // notified を刻んで送信先を返す（退職者へタイトルを漏らさない・cronと二重送信しない）。
            const approverExternalUserId = await claimApprovalNotification(taskId)
            if (approverExternalUserId) {
              const retryKey = buildDigestRetryKey(taskId, 'approval-notify')
              try {
                await pushLineMessage({
                  accessToken: account.accessToken,
                  to: approverExternalUserId,
                  messages: [
                    buildApprovalPromptFlexMessage({
                      taskId,
                      title,
                      dueDate: due.dueDate,
                      dueTime: due.dueTime,
                      todayJst: formatDateToLocalString(now),
                    }),
                  ],
                  // cron 送信と同一キー。曖昧失敗→null→cron再送でも LINE 側で二重化しない（§4-5）
                  retryKey,
                })
                // push成功後にoutbound記録（billablePush=true）を残す。externalMessageIdは
                // cron(approval-notify)と同一キー＝クロス経路（即時×cron）でも二重計上しない
                // （設計正本 §3・PR4メータリング）。
                await insertChannelMessage({
                  orgId: group.orgId,
                  spaceId: group.spaceId,
                  identityId: null,
                  accountId: account.id,
                  groupId: null,
                  channel: 'line',
                  direction: 'outbound',
                  actor: 'secretary',
                  externalUserId: approverExternalUserId,
                  externalMessageId: retryKey,
                  contentType: 'text',
                  body: title,
                  payload: { autoReplyTo: `approval-notify:${taskId}` },
                  storagePath: null,
                  status: 'sent',
                  error: null,
                  occurredAt: new Date().toISOString(),
                  billablePush: true,
                })
              } catch (pushError) {
                // 送信失敗（曖昧含む）→ 未通知へ戻し cron／コンソールに委ねる
                console.error('handleMentionInstantTask: approval push failed', pushError)
                await clearApprovalNotifiedAt(taskId).catch((clearError) =>
                  console.error('handleMentionInstantTask: clearApprovalNotifiedAt failed', clearError),
                )
              }
            }
          }
        } catch (claimError) {
          // claim RPC・quotaポリシー読取の一時障害。候補は既に pending で残るため cron／コンソールが拾う。
          // reply（主フロー）は続行し、webhook を非200で落とさない（LINE再送で候補を作り直させない）。
          console.error('handleMentionInstantTask: claim approval notification failed', claimError)
        }
      }

      replyText = APPROVAL_REQUESTED_TEXT
    } else {
      const detail = buildTaskDetailLine(
        due.dueDate,
        due.dueTime,
        assignee.assigneeHint,
        formatDateToLocalString(now),
      )
      replyText = detail
        ? `タスクに追加しました。\n『${title}』\n${detail}`
        : `タスクに追加しました。\n『${title}』`
    }
  }

  if (event.replyToken) {
    await replyLineMessage({
      accessToken: account.accessToken,
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: replyText }],
    })
  }
  await insertChannelMessage({
    orgId: group.orgId,
    spaceId: group.spaceId,
    identityId: null,
    accountId: account.id,
    groupId: group.id,
    channel: 'line',
    direction: 'outbound',
    actor: 'secretary',
    externalUserId: null,
    externalMessageId: null,
    contentType: 'text',
    body: replyText,
    payload: { autoReplyTo: event.webhookEventId },
    storagePath: null,
    status: event.replyToken ? 'sent' : 'failed',
    error: event.replyToken ? null : 'no replyToken',
    occurredAt: new Date().toISOString(),
  })
}

type PostbackAction = 'digest_done' | 'digest_undo'
type PostbackResult = 'done' | 'already_done' | 'reopened' | 'cannot_undo'

/**
 * postback(digest_done / digest_undo・Stage 2.5 §3-2)。消し込み・取り消し操作の原本証跡は
 * channel_messagesに残す（§2.3）。
 *
 * ★世代混同の防止（実害あり・必ず守ること）: 検証は「今まさにwebhookを受けた物理グループの
 * *現active世代*」を唯一の真実源にする。旧世代（unlink済み／同一物理グループが別テナントへ
 * 再紐付けされた後）に配達済みの古いFlexボタンを後から押されても、
 * 「task.accountId一致」「taskの旧groupのexternalGroupId一致」だけでは通ってしまい、
 * 現テナントのactive世代とtask.groupIdの一致を見ていなかった（再現: G→A社紐付け→旧Flex残存
 * →G unlink→同一G→B社へ新世代紐付け→G上で旧Flexタップ→検証通過→A社task更新・監査がB社に
 * 保存・A社task名がB社グループへ返信、という越境）。
 *
 * 手順（mutationより前に必ずこの順で。TOCTOUを最小化する）:
 *   1. activeGroup = findActiveGroup(account.id, event.groupId) を最初に解決する
 *      （event.groupIdが無ければ活動不能=null。org境界を検証できないため以降フォールバック無し）。
 *   2. activeGroupが無ければ、mutation/reply/保存を一切行わず終了する
 *      （org: 既存の「該当group無し」相当の無害終了。platform: limboと同型の無反応）。
 *   3. task.groupId===activeGroup.id ／ task.orgId===activeGroup.orgId ／
 *      task.accountId===account.id を全て満たさない限りmutationしない（1つでも外れたら終了）。
 *      共有bot(platform)はaccount.orgIdが常にnullのため、account.orgIdでの照合はしない。
 *   4. 検証通過後にのみ markDigestTaskDoneAtomic／reopenDigestTaskAtomicを実行し、
 *      監査INSERTのorg_id/space_id/group_idは常にactiveGroup起点（taskの旧groupではない）。
 * これにより「旧Flex×再紐付け後」「旧Flex×limbo」のいずれも mutation/返信/保存が0になる
 * （旧taskの存在や内容を外部に一切明かさない。存在オラクルを作らない）。
 *
 * 既知の残存TOCTOU（本PRでは踏み込まない・意図的）: 上記検証とmutationの間で
 * unlink/再紐付けが割り込む極めて狭い競合は、markDigestTaskDoneAtomic等のRPCシグネチャに
 * expected_group_id を渡す形（要migration）でないと閉じられない。今回のapp層
 * resolve-first＋verify-firstは、報告された実害（配達済みの旧Flexタップ）を確実に封じる。
 * 残る狭いレースはPR後続でRPCへexpected_group_idを渡して閉じる。
 *
 * org専用bot経路も同じ検証を通す（同一org内でも別spaceへ再紐付け後の旧Flexで別spaceの
 * taskを触れる同型バグがあるため、owner_typeで免除しない）。
 */
async function processPostback(
  account: LineAccount,
  event: NormalizedLineEvent,
  disabled: boolean,
): Promise<void> {
  const data = event.postbackData ?? ''

  // 責任者確認（Stage 2.7-B）は 1:1 トークに届く別系統。アクター解決・テナント/認可は
  // _via_line RPC が完結させるため、消し込み系の検証チェーンには乗せず専用ハンドラへ委ねる。
  const promoteAction = parseDigestPromotePostback(data)
  const rejectAction = promoteAction ? null : parseDigestRejectPostback(data)
  if (promoteAction || rejectAction) {
    await processApprovalPostback(
      account,
      event,
      disabled,
      promoteAction ? 'digest_promote' : 'digest_reject',
      (promoteAction ?? rejectAction)!.taskId,
      promoteAction?.assignSelf ?? false,
    )
    return
  }

  const doneAction = parseDigestDonePostback(data)
  const undoAction = doneAction ? null : parseDigestUndoPostback(data)
  if (!doneAction && !undoAction) return

  const actionKind: PostbackAction = doneAction ? 'digest_done' : 'digest_undo'
  const taskId = (doneAction ?? undoAction)!.taskId

  // 1. 現active世代を最初に解決する（いかなるmutation・task読み取りの検証判断よりも前）。
  const activeGroup = event.groupId ? await findActiveGroup(account.id, event.groupId) : null
  if (!activeGroup) {
    // 2. 未解決(limbo・group取りこぼし・event.groupId無し等)。mutation/reply/保存を一切しない。
    return
  }

  const task = await findDigestTaskForVerification(taskId)

  // 3. taskが「今まさにactiveな世代」に属することを全条件で確認する。
  const verified =
    !!task &&
    task.groupId === activeGroup.id &&
    task.orgId === activeGroup.orgId &&
    task.accountId === account.id

  if (!verified) {
    if (task) {
      console.error(
        'LINE webhook: postback task does not belong to the current active group (stale/relinked)',
        taskId,
      )
    }
    // mutation/reply/保存を一切しない（旧世代Flex・偽装taskIdのいずれも痕跡を残さない）。
    return
  }

  // 4. 検証通過後にのみmutationを実行する。
  let result: PostbackResult
  let resultTitle: string | null = null
  if (actionKind === 'digest_done') {
    // 原子更新（status='open'のみ）。0行なら二重タップ等で既に完了済み
    const updated = await markDigestTaskDoneAtomic(taskId, 'postback', event.externalUserId ?? null)
    if (updated) {
      result = 'done'
      resultTitle = updated.title
    } else {
      result = 'already_done'
    }
  } else {
    // 原子更新（status='done'かつdone_atが24時間以内のみ）。0行なら取り消せない
    const reopened = await reopenDigestTaskAtomic(taskId)
    if (reopened) {
      result = 'reopened'
      resultTitle = reopened.title
    } else {
      result = 'cannot_undo'
    }
  }

  // 監査INSERTはactiveGroup起点（taskの旧groupではない。常に非null）。
  const recorded = await insertChannelMessage({
    orgId: activeGroup.orgId,
    spaceId: activeGroup.spaceId,
    identityId: null,
    accountId: account.id,
    groupId: activeGroup.id,
    channel: 'line',
    direction: 'inbound',
    actor: 'system',
    externalUserId: event.externalUserId,
    externalMessageId: event.webhookEventId,
    contentType: 'system',
    body: null,
    payload: { event: 'postback', action: actionKind, taskId, result },
    storagePath: null,
    status: 'received',
    error: null,
    occurredAt: event.occurredAt,
  })

  // webhook再送(dedupe)時はreplyを再送しない。
  // disabled中は自動応答(reply)のみ停止する（記録・状態確定は既に完了している）
  if (recorded === 'duplicate' || disabled) return
  if (!event.replyToken) return

  if (actionKind === 'digest_done') {
    const replyMessage =
      result === 'done'
        ? await buildNamedDoneMessage(
            account,
            activeGroup.externalGroupId,
            event.externalUserId,
            resultTitle!,
            taskId,
          )
        : ({ type: 'text' as const, text: ALREADY_DONE_TEXT })
    await replyLineMessage({
      accessToken: account.accessToken,
      replyToken: event.replyToken,
      messages: [replyMessage],
    })
  } else {
    const replyText = result === 'reopened' ? buildTaskUndoReply(resultTitle!) : UNDO_FAILED_TEXT
    await replyLineMessage({
      accessToken: account.accessToken,
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: replyText }],
    })
  }
}

type ApprovalAction = 'digest_promote' | 'digest_reject'
type ApprovalResult = 'promoted' | 'already_promoted' | 'rejected' | 'conflict' | 'forbidden' | 'not_found'

/**
 * 責任者確認ボタン（1:1 トーク）の承認/却下。owner_type='org'専用bot限定
 * （共有botの内部承認1:1連携は未対応。設計正本 §7「共有bot 1:1の将来対応」）。
 *
 * 消し込み(digest_done)と違い、アクター解決・テナント境界・認可はすべて _via_line RPC が
 * DB内で完結させる（webhook 検証済みの account.id と external_user_id のみ渡し、body 由来の
 * 内部 UUID は一切渡さない＝confused deputy を作らない）。ここでは status を返信と証跡へ写すだけ。
 *
 * 非承認系（forbidden / not_found）と一過性の例外は、返信も監査行も残さず *完全に沈黙* する
 * （第三者に候補の存在/状態を推測させる差分を一切作らない）。監査・返信は実際に状態へ作用した
 * 結果だけに限り、それらは via_line + 認可ファーストにより現・責任者本人にしか返らない。
 * 記録する結果については disabled 中も監査行は残し、reply（自動応答）だけ止める。
 */
async function processApprovalPostback(
  account: LineAccount,
  event: NormalizedLineEvent,
  disabled: boolean,
  action: ApprovalAction,
  taskId: string,
  assignSelf = false,
): Promise<void> {
  if (account.ownerType === 'platform') return // 共有botの内部承認1:1連携は未対応（org解決不能）

  // 承認ボタンは 1:1 トーク専用。グループ/ルームに転送・再利用されたボタンでは動かさない
  // （公開の場に承認結果を返さない・監査の帰属を壊さない）。認可自体はRPCも守るが、
  // ここで文脈を先に閉じる。1:1 identity が無ければアクター解決も不能。
  const externalUserId = event.externalUserId
  if (event.sourceType !== 'user' || !externalUserId) return

  let result: ApprovalResult
  try {
    if (action === 'digest_promote') {
      const r = await promoteDigestTaskViaLine(account.id, externalUserId, taskId, assignSelf)
      result = r.status === 'promoted' ? (r.created ? 'promoted' : 'already_promoted') : r.status
    } else {
      const r = await rejectDigestTaskViaLine(account.id, externalUserId, taskId)
      result = r.status // 'rejected' | 'conflict' | 'forbidden' | 'not_found'
    }
  } catch (e) {
    // 一過性のRPC失敗。ここで返信も監査行も残すと、非承認者に対して「反応あり vs 沈黙」の
    // 存在/状態オラクルになる（例外時点では承認者か否か未確定）。よって forbidden/not_found と
    // *完全に同一の沈黙*（返信なし・監査行なし）にして外形上区別不能にする。認可済み本人の
    // 一過性失敗はコンソールの「確認待ち」トレイが確実なフォールバックになる。
    // バッチは落とさない（他イベントの処理は継続）。
    console.error('LINE webhook: approval postback RPC failed', action, taskId, e)
    return
  }

  // 非承認系（forbidden / not_found）は *何も残さない*（返信も監査行も）。
  // via_line は未認可・非存在・テナント不一致をすべて forbidden に畳むため、これらは
  // 「第三者による無権限タップ」であり、行の有無が存在オラクルにならないよう例外と揃える。
  // 監査に残すのは実際に状態へ作用した結果（promoted/already/rejected/conflict）だけ。
  // それらは via_line + 認可ファーストにより *現・責任者本人* にしか返らない。
  const replyText =
    result === 'promoted'
      ? PROMOTE_DONE_TEXT
      : result === 'already_promoted'
        ? PROMOTE_ALREADY_TEXT
        : result === 'rejected'
          ? REJECT_DONE_TEXT
          : result === 'conflict'
            ? APPROVAL_CONFLICT_TEXT
            : null
  if (!replyText) return // forbidden / not_found → 完全沈黙

  const recorded = await insertChannelMessage({
    orgId: account.orgId,
    spaceId: null, // 1:1 トークには space が無い
    identityId: null,
    accountId: account.id,
    groupId: null,
    channel: 'line',
    direction: 'inbound',
    actor: 'system',
    externalUserId,
    externalMessageId: event.webhookEventId,
    contentType: 'system',
    body: null,
    payload: { event: 'postback', action, taskId, result },
    storagePath: null,
    status: 'received',
    error: null,
    occurredAt: event.occurredAt,
  })

  if (recorded === 'duplicate' || disabled) return
  if (!event.replyToken) return

  await replyLineMessage({
    accessToken: account.accessToken,
    replyToken: event.replyToken,
    messages: [{ type: 'text', text: replyText }],
  })
}
