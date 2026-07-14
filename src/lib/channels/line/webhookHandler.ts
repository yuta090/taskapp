import {
  extractUserLinkCode,
  looksLikeUserLinkCode,
  maskUserLinkCode,
  hashUserLinkCode,
} from '@/lib/channels/userLink'
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
  type LineAccount,
  type InsertChannelMessageInput,
  type ValidLinkCode,
  type ChannelGroup,
  consumeUserLinkCode,
  expireUserLinkCode,
  promoteDigestTaskViaLine,
  rejectDigestTaskViaLine,
} from '@/lib/channels/store'
import { disableStaleGroupSinks } from '@/lib/sinks/store'
import { notifySinkDisabledForRelink } from '@/lib/sinks/notify'
import {
  pushLineMessage,
  fetchLineMessageContent,
  replyLineMessage,
  leaveRoom,
  fetchGroupMemberProfile,
} from '@/lib/channels/line/client'
import { verifyLineSignature } from '@/lib/channels/line/verify'
import {
  parseLineWebhookBody,
  normalizeLineEvent,
  type NormalizedLineEvent,
} from '@/lib/channels/line/events'
import { normalizeLinkCode } from '@/lib/channels/linkCode'
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
} from '@/lib/channels/digest/compute'
import { parseJapaneseDue } from '@/lib/channels/digest/due'
import { formatDateToLocalString } from '@/lib/gantt/dateUtils'

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
 */

export interface WebhookHandleResult {
  status: number
  body: Record<string, unknown>
}

/** 初回挨拶。AI名乗りと記録明示は §9 の固定文言 — 削らないこと */
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
  return `『${title}』を申し送りに戻しました。`
}

const UNDO_FAILED_TEXT =
  '取り消せませんでした（完了から24時間以上経過、または既に戻されています）。コンソールからも戻せます。'

// 責任者確認（Stage 2.7-B）の 1:1 返信文言
const PROMOTE_DONE_TEXT = '承認しました。タスクに登録し、担当の画面に追加しました。'
const PROMOTE_ALREADY_TEXT = 'すでにタスク化済みです。'
const REJECT_DONE_TEXT = '却下しました。タスクには登録しません。'
const APPROVAL_CONFLICT_TEXT = 'この項目はすでに処理済みです。'

const MENTION_TITLE_EMPTY_TEXT =
  '内容が読み取れませんでした。メンションに続けて申し送り内容をお書きください。'

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
    // webhook再送(dedupe)時は挨拶も再送しない
    const recorded = await recordSystemEvent(account, event, 'follow')
    if (recorded === 'duplicate' || disabled) return
    await sendSecretaryText(account, event.externalUserId!, buildGreeting(account.displayName), {
      relatedEventId: event.webhookEventId,
    })
    return
  }
  if (event.kind === 'unfollow') {
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
// ---------------------------------------------------------------------------

async function processDirectMessage(
  account: LineAccount,
  event: NormalizedLineEvent,
  disabled: boolean,
): Promise<void> {
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
 * 内部ユーザーの本人紐付け（Stage 2.7-A）。1:1トークでのみ受理する。
 *
 * 記録は必ず先に行う（inboundTextRecord がコードをマスクするので、平文はDBに残らない）。
 * RPC は例外を投げず status で返す — 例外だと同一トランザクション内の試行履歴も
 * ロールバックされ、総当たり対策が機能しなくなるため。
 */
async function processUserLinkCode(
  account: LineAccount,
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
  account: LineAccount,
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
  account: LineAccount,
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
  account: LineAccount,
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
  account: LineAccount,
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
  })
}

// ---------------------------------------------------------------------------
// グループ（Stage 2b）
// ---------------------------------------------------------------------------

function groupMessageRecord(
  account: LineAccount,
  event: NormalizedLineEvent,
  group: ChannelGroup | null,
  identityId: string | null,
  storagePath: string | null,
  status: InsertChannelMessageInput['status'] = 'received',
  errorText: string | null = null,
): InsertChannelMessageInput {
  return {
    orgId: account.orgId,
    // グループ発言のspace_idは常にグループ由来のみ（identity自動帰属は絶対に適用しない）
    spaceId: group?.spaceId ?? null,
    identityId,
    accountId: account.id,
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
  })
}

async function processGroupLeave(account: LineAccount, event: NormalizedLineEvent): Promise<void> {
  const externalGroupId = event.groupId!
  const group = await findActiveGroup(account.id, externalGroupId)
  await markGroupLeft(account.id, externalGroupId)
  await insertChannelMessage({
    orgId: account.orgId,
    spaceId: group?.spaceId ?? null,
    identityId: null,
    accountId: account.id,
    groupId: group?.id ?? null,
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
 */
async function processRoomJoin(account: LineAccount, event: NormalizedLineEvent): Promise<void> {
  const roomId = event.roomId!
  const recorded = await insertChannelMessage({
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

  // 内部ユーザーの本人紐付けコードがグループに貼られた（誤爆）。
  // グループの全員がそれを読めてしまうため、紐付けは *成立させず* コードを即時失効させる。
  // 本文は groupMessageRecord がマスクするので、会話ログにも平文は残らない。
  const leakedCode = event.contentType === 'text' ? extractUserLinkCode(event.body) : null
  if (leakedCode) {
    // 本文全体ではなく *抽出したコード* をハッシュする。ここを取り違えると、
    // 文章付きで貼られたコードが失効せず、グループの参加者がそれを1:1で使えてしまう
    const expired = await expireUserLinkCode(hashUserLinkCode(leakedCode))
    const recorded = await insertChannelMessage(groupMessageRecord(account, event, group, null, null))
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

  if (!group) {
    // 万一activeな世代が無い場合（join取りこぼし等）。帰属無しで記録だけ行う
    await insertChannelMessage(groupMessageRecord(account, event, null, null, null))
    return
  }

  // identity_idの記録は参考情報として可（誰の発言かのメモ）。space_idには絶対反映しない。
  // ただし identity は必ずこのグループの space のものに限る。org内の先頭を無条件に採ると、
  // 同一人物が複数顧問先の窓口（社長が2法人経営等）のとき別顧問先のidentityを記録し得る。
  // channel_messages.identity_id は一度入ると変更できないため、誤りが残り続ける。
  // 未紐付けグループ（space_id null）はそもそも誰の窓口か言えないので null にする。
  const identityId = event.externalUserId
    ? (
        await findIdentityIdsByExternalUserIds(account.orgId, group.spaceId, [event.externalUserId])
      ).get(event.externalUserId) ?? null
    : null

  if (event.contentType === 'text' && event.body) {
    const digestNumber = parseDigestCompleteCommand(event.body)
    if (digestNumber !== null) {
      await handleDigestCompleteCommand(account, event, group, identityId, digestNumber, disabled)
      return
    }

    // 既に紐付け済みグループへのコード形状テキストは通常メッセージ扱い（帰属を保つ）
    if (group.spaceId === null) {
      const code = normalizeLinkCode(event.body)
      if (code) {
        const linkCode = await findValidLinkCode(code)
        if (linkCode && linkCode.orgId === account.orgId) {
          await processGroupLinkCode(account, event, group, linkCode, identityId, disabled)
          return
        }
      }
    }

    // メンション即時タスク化（Stage 2.5 §2）: mention_only のみ。all は夜間抽出で拾うため
    // 経路を分ける（同じsource_message_idでtitleが異なると unique 制約をすり抜けて二重登録になる）
    if (group.pickupMode === 'mention_only' && event.mentionsSelf) {
      await handleMentionInstantTask(account, event, group, identityId, disabled)
      return
    }
  }

  let storagePath: string | null = null
  let status: InsertChannelMessageInput['status'] = 'received'
  let errorText: string | null = null

  if (event.contentType !== 'text') {
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

  await insertChannelMessage(
    groupMessageRecord(account, event, group, identityId, storagePath, status, errorText),
  )
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
          await findIdentityIdsByExternalUserIds(account.orgId, currentGroup.spaceId, [
            event.externalUserId,
          ])
        ).get(event.externalUserId) ?? null
      : null)

  const recorded = await insertChannelMessage(
    groupMessageRecord(account, event, currentGroup, resolvedIdentityId, null),
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
    orgId: account.orgId,
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
  const recorded = await insertChannelMessage(groupMessageRecord(account, event, group, identityId, null))
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
    body: replyBodyForRecord,
    payload: { autoReplyTo: event.webhookEventId },
    storagePath: null,
    status: event.replyToken ? 'sent' : 'failed',
    error: event.replyToken ? null : 'no replyToken',
    occurredAt: new Date().toISOString(),
  })
}

/**
 * メンション即時タスク化（Stage 2.5 §2）: mention_only グループでbot宛メンションを検知した際のパス。
 * disabled中は記録のみで終了する（digest系の自動動作はdisabledで停止、の既存原則に従う）。
 */
async function handleMentionInstantTask(
  account: LineAccount,
  event: NormalizedLineEvent,
  group: ChannelGroup,
  identityId: string | null,
  disabled: boolean,
): Promise<void> {
  const recorded = await insertChannelMessage(groupMessageRecord(account, event, group, identityId, null))
  if (recorded === 'duplicate') return
  if (disabled) return

  const body = event.body ?? ''
  // 秘書宛メンションに加えて担当者宛メンションもタイトルから除去する
  // （担当は assignee_hint に別で持つため、タイトルに '@山田' を残さない）
  const mentionSpans = [...(event.selfMentionSpans ?? []), ...(event.assigneeMentions ?? [])]
  const title = buildMentionTaskTitle(body, mentionSpans)

  let replyText: string
  if (!title) {
    replyText = MENTION_TITLE_EMPTY_TEXT
  } else {
    // 期限は本文（メンション除去前）から解決する。titleは50字で切り詰められるため、
    // 末尾の期限表現がタイトルから落ちていても本文には残っている
    const now = new Date()
    const due = parseJapaneseDue(body, now)
    // 即時パスはLLMを通さない（即応性を優先）。担当はメンションだけから決める
    const assignee = resolveAssignee(event.assigneeMentions, null)

    let assigneeIdentityId: string | null = null
    if (assignee.assigneeExternalUserId) {
      // 必ずこのグループの space で解決する（他顧問先のidentityを引かない）
      const identities = await findIdentityIdsByExternalUserIds(account.orgId, group.spaceId, [
        assignee.assigneeExternalUserId,
      ])
      assigneeIdentityId = identities.get(assignee.assigneeExternalUserId) ?? null
    }

    await createInstantDigestTask({
      orgId: account.orgId,
      groupId: group.id,
      spaceId: group.spaceId,
      sourceMessageId: recorded.id,
      title,
      assigneeHint: assignee.assigneeHint,
      assigneeExternalUserId: assignee.assigneeExternalUserId,
      assigneeIdentityId,
      dueDate: due.dueDate,
      dueTime: due.dueTime,
    })

    const detail = buildTaskDetailLine(
      due.dueDate,
      due.dueTime,
      assignee.assigneeHint,
      formatDateToLocalString(now),
    )
    replyText = detail
      ? `申し送りに追加しました。\n『${title}』\n${detail}`
      : `申し送りに追加しました。\n『${title}』`
  }

  if (event.replyToken) {
    await replyLineMessage({
      accessToken: account.accessToken,
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: replyText }],
    })
  }
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
    body: replyText,
    payload: { autoReplyTo: event.webhookEventId },
    storagePath: null,
    status: event.replyToken ? 'sent' : 'failed',
    error: event.replyToken ? null : 'no replyToken',
    occurredAt: new Date().toISOString(),
  })
}

type PostbackAction = 'digest_done' | 'digest_undo'
type PostbackResult = 'done' | 'already_done' | 'reopened' | 'cannot_undo' | 'rejected'

/**
 * postback(digest_done / digest_undo・Stage 2.5 §3-2)。消し込み・取り消し操作の原本証跡は
 * channel_messagesに残す（§2.3）。記録は disabled 中も必ず行う（inboundの記録continuityは
 * 他イベントと同じ）。disabled中に止めるのは「自動応答」= reply送信のみ。
 * 検証・状態確定(消し込み/取り消し)自体はユーザーの実際の操作を正しく反映するため常に行う。
 * digest_undo も digest_done と同一の検証チェーン（task→group→account→org一致）を通す。
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
    )
    return
  }

  const doneAction = parseDigestDonePostback(data)
  const undoAction = doneAction ? null : parseDigestUndoPostback(data)
  if (!doneAction && !undoAction) return

  const actionKind: PostbackAction = doneAction ? 'digest_done' : 'digest_undo'
  const taskId = (doneAction ?? undoAction)!.taskId

  const task = await findDigestTaskForVerification(taskId)
  let rejected = false

  if (!task) {
    rejected = true
  } else if (task.accountId !== account.id || task.orgId !== account.orgId) {
    // 検証: task→group→account→orgの系列がwebhookで解決したaccountと一致すること
    console.error('LINE webhook: postback task belongs to a different account/org', taskId)
    rejected = true
  } else if (event.groupId) {
    // 検証: task.group_idがwebhookを受けたグループのものであること
    const taskGroup = await findGroupById(task.groupId)
    if (!taskGroup || taskGroup.externalGroupId !== event.groupId) {
      console.error('LINE webhook: postback task belongs to a different group', taskId)
      rejected = true
    }
  }

  let result: PostbackResult
  let resultTitle: string | null = null
  if (rejected) {
    result = 'rejected'
  } else if (actionKind === 'digest_done') {
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

  // 記録用のgroup_idはwebhookを受けたグループ基準（taskの帰属先ではなく、タップが物理的に発生した場所）
  const group = event.groupId ? await findActiveGroup(account.id, event.groupId) : null

  const recorded = await insertChannelMessage({
    orgId: account.orgId,
    spaceId: group?.spaceId ?? null,
    identityId: null,
    accountId: account.id,
    groupId: group?.id ?? null,
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

  // webhook再送(dedupe)時はreplyを再送しない。rejectedは何も返さない（不正リクエストへの応答を避ける）。
  // disabled中は自動応答(reply)のみ停止する（記録・状態確定は既に完了している）
  if (recorded === 'duplicate' || disabled || rejected) return
  if (!event.replyToken) return

  if (actionKind === 'digest_done') {
    const replyMessage =
      result === 'done'
        ? await buildNamedDoneMessage(account, event.groupId ?? '', event.externalUserId, resultTitle!, taskId)
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
 * 責任者確認ボタン（1:1 トーク）の承認/却下。
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
): Promise<void> {
  // 承認ボタンは 1:1 トーク専用。グループ/ルームに転送・再利用されたボタンでは動かさない
  // （公開の場に承認結果を返さない・監査の帰属を壊さない）。認可自体はRPCも守るが、
  // ここで文脈を先に閉じる。1:1 identity が無ければアクター解決も不能。
  const externalUserId = event.externalUserId
  if (event.sourceType !== 'user' || !externalUserId) return

  let result: ApprovalResult
  try {
    if (action === 'digest_promote') {
      const r = await promoteDigestTaskViaLine(account.id, externalUserId, taskId)
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
