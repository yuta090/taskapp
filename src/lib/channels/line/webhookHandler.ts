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
  type LineAccount,
  type InsertChannelMessageInput,
  type ValidLinkCode,
  type ChannelGroup,
} from '@/lib/channels/store'
import {
  pushLineMessage,
  fetchLineMessageContent,
  replyLineMessage,
  leaveRoom,
} from '@/lib/channels/line/client'
import { verifyLineSignature } from '@/lib/channels/line/verify'
import {
  parseLineWebhookBody,
  normalizeLineEvent,
  type NormalizedLineEvent,
} from '@/lib/channels/line/events'
import { normalizeLinkCode } from '@/lib/channels/linkCode'
import { parseDigestCompleteCommand } from '@/lib/channels/digest/commands'
import { parseDigestDonePostback } from '@/lib/channels/digest/postback'

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

function buildTaskDoneReply(title: string): string {
  return `『${title}』を完了にしました。`
}

const ALREADY_DONE_TEXT = 'そのタスクは既に完了済みです。'

const LINK_CODE_FAILED_TEXT =
  '確認コードをお確かめのうえ、もう一度お送りください。ご不明な場合は事務所までご連絡ください。'

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
    body: event.body,
    payload: event.payload,
    storagePath,
    status,
    error: errorText,
    occurredAt: event.occurredAt,
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
    body: event.body,
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
    body: event.body,
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

  if (!group) {
    // 万一activeな世代が無い場合（join取りこぼし等）。帰属無しで記録だけ行う
    await insertChannelMessage(groupMessageRecord(account, event, null, null, null))
    return
  }

  // identity_idの記録は参考情報として可（誰の発言かのメモ）。space_idには絶対反映しない
  const identityId = event.externalUserId
    ? (await findActiveLineIdentities(account.orgId, event.externalUserId))[0]?.id ?? null
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
  } else {
    // レース: 既に他方が紐付け済み。現在値を再取得して整合させる
    currentGroup = (await findGroupById(group.id)) ?? group
  }

  const recorded = await insertChannelMessage(
    groupMessageRecord(account, event, currentGroup, identityId, null),
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
  const replyText = result ? buildTaskDoneReply(result.title) : ALREADY_DONE_TEXT

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

type PostbackResult = 'done' | 'already_done' | 'rejected'

/**
 * postback(digest_done)。消し込み操作の原本証跡はchannel_messagesに残す（§2.3）。
 * 記録は disabled 中も必ず行う（inboundの記録continuityは他イベントと同じ）。
 * disabled中に止めるのは「自動応答」= reply送信のみ。検証・状態確定(消し込み)自体は
 * ユーザーの実際の操作を正しく反映するため常に行う。
 */
async function processPostback(
  account: LineAccount,
  event: NormalizedLineEvent,
  disabled: boolean,
): Promise<void> {
  const action = parseDigestDonePostback(event.postbackData ?? '')
  if (!action) return

  const task = await findDigestTaskForVerification(action.taskId)
  let rejected = false

  if (!task) {
    rejected = true
  } else if (task.accountId !== account.id || task.orgId !== account.orgId) {
    // 検証: task→group→account→orgの系列がwebhookで解決したaccountと一致すること
    console.error('LINE webhook: postback task belongs to a different account/org', action.taskId)
    rejected = true
  } else if (event.groupId) {
    // 検証: task.group_idがwebhookを受けたグループのものであること
    const taskGroup = await findGroupById(task.groupId)
    if (!taskGroup || taskGroup.externalGroupId !== event.groupId) {
      console.error('LINE webhook: postback task belongs to a different group', action.taskId)
      rejected = true
    }
  }

  let result: PostbackResult
  let doneTitle: string | null = null
  if (rejected) {
    result = 'rejected'
  } else {
    // 原子更新（status='open'のみ）。0行なら二重タップ等で既に完了済み
    const updated = await markDigestTaskDoneAtomic(action.taskId, 'postback', event.externalUserId ?? null)
    if (updated) {
      result = 'done'
      doneTitle = updated.title
    } else {
      result = 'already_done'
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
    payload: { event: 'postback', action: 'digest_done', taskId: action.taskId, result },
    storagePath: null,
    status: 'received',
    error: null,
    occurredAt: event.occurredAt,
  })

  // webhook再送(dedupe)時はreplyを再送しない。rejectedは何も返さない（不正リクエストへの応答を避ける）。
  // disabled中は自動応答(reply)のみ停止する（記録・状態確定は既に完了している）
  if (recorded === 'duplicate' || disabled || rejected) return

  const replyText = result === 'done' ? buildTaskDoneReply(doneTitle!) : ALREADY_DONE_TEXT
  if (event.replyToken) {
    await replyLineMessage({
      accessToken: account.accessToken,
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: replyText }],
    })
  }
}
