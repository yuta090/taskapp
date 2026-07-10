import {
  findLineAccountByDestination,
  findActiveLineIdentities,
  insertChannelMessage,
  findValidLinkCode,
  linkIdentityViaCode,
  uploadAttachment,
  type LineAccount,
  type InsertChannelMessageInput,
  type ValidLinkCode,
} from '@/lib/channels/store'
import { pushLineMessage, fetchLineMessageContent } from '@/lib/channels/line/client'
import { verifyLineSignature } from '@/lib/channels/line/verify'
import {
  parseLineWebhookBody,
  normalizeLineEvent,
  type NormalizedLineEvent,
} from '@/lib/channels/line/events'
import { normalizeLinkCode } from '@/lib/channels/linkCode'

/**
 * LINE webhook のオーケストレーション。
 *
 * 順序厳守: 未検証ボディは destination 抽出以外に使わない。
 *   destination 抽出 → アカウント逆引き → アカウント別 secret で署名検証 → イベント処理
 *
 * LINE は非2xxを再送するため、処理不能なリクエストは 200 で無視する
 * （401は署名不正=正当な送信元でない場合のみ）。
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

const LINK_CODE_FAILED_TEXT =
  '確認コードをお確かめのうえ、もう一度お送りください。ご不明な場合は事務所までご連絡ください。'

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
  if (event.kind === 'follow') {
    // webhook再送(dedupe)時は挨拶も再送しない
    const recorded = await recordSystemEvent(account, event, 'follow')
    if (recorded === 'duplicate') return
    await sendSecretaryText(account, event.externalUserId, buildGreeting(account.displayName), {
      relatedEventId: event.webhookEventId,
    })
    return
  }

  if (event.kind === 'unfollow') {
    await recordSystemEvent(account, event, 'unfollow')
    return
  }

  // message イベント
  const identities = await findActiveLineIdentities(account.orgId, event.externalUserId)

  if (event.contentType === 'text' && event.body) {
    const code = normalizeLinkCode(event.body)
    if (code) {
      const linkCode = await findValidLinkCode(code)
      // 他org（別事務所のOA）のコードは成立させない
      if (linkCode && linkCode.orgId === account.orgId) {
        await processLinkCode(account, event, linkCode)
        return
      }
      // 有効コードでない場合: 未突合ユーザーにだけ案内を返す。
      // リンク済みユーザーのコード形状テキスト（参照番号等）は通常メッセージとして
      // フォールスルーし、帰属を失わない
      if (identities.length === 0) {
        const recorded = await insertChannelMessage(inboundTextRecord(account, event, null, null))
        if (recorded !== 'duplicate') {
          await sendSecretaryText(account, event.externalUserId, LINK_CODE_FAILED_TEXT, {
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
  })
}

async function processLinkCode(
  account: LineAccount,
  event: NormalizedLineEvent,
  linkCode: ValidLinkCode,
): Promise<void> {
  // linkIdentityViaCode は冪等（既にactiveなら既存を返す）
  const identity = await linkIdentityViaCode(linkCode, event.externalUserId)
  const recorded = await insertChannelMessage(
    inboundTextRecord(account, event, identity.spaceId, identity.id),
  )
  // webhook再送(dedupe)時は確認返信も再送しない
  if (recorded === 'duplicate') return
  await sendSecretaryText(
    account,
    event.externalUserId,
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
  eventName: 'follow' | 'unfollow',
): Promise<{ id: string } | 'duplicate'> {
  return insertChannelMessage({
    orgId: account.orgId,
    spaceId: null,
    identityId: null,
    accountId: account.id,
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
