/**
 * LINE webhook イベントの正規化。
 * rawイベントを channel_messages へ保存できる形に落とす。
 * 対応外イベントは null（webhookは常に200を返し、LINE側の再送ループを防ぐ）。
 */

interface LineEventSource {
  type: string
  userId?: string
  groupId?: string
  roomId?: string
}

interface LineMessagePayload {
  id: string
  type: string
  text?: string
  contentProvider?: { type: string }
  fileName?: string
  fileSize?: number
  duration?: number
}

export interface LineWebhookEvent {
  type: string
  webhookEventId: string
  deliveryContext: { isRedelivery: boolean }
  timestamp: number
  mode: string
  source: LineEventSource
  replyToken?: string
  message?: LineMessagePayload
  [key: string]: unknown
}

export interface ParsedLineWebhookBody {
  destination: string
  events: LineWebhookEvent[]
}

export function parseLineWebhookBody(rawBody: string): ParsedLineWebhookBody | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const body = parsed as { destination?: unknown; events?: unknown }
  if (typeof body.destination !== 'string' || !Array.isArray(body.events)) return null
  return { destination: body.destination, events: body.events as LineWebhookEvent[] }
}

export type NormalizedEventKind = 'message' | 'follow' | 'unfollow'

export interface NormalizedLineEvent {
  kind: NormalizedEventKind
  externalUserId: string
  /** message イベントは message.id、follow/unfollow は webhookEventId */
  externalMessageId: string
  webhookEventId: string
  isRedelivery: boolean
  contentType: 'text' | 'image' | 'file' | 'video' | 'audio' | 'sticker' | 'system'
  body: string | null
  occurredAt: string
  payload: Record<string, unknown>
}

const MESSAGE_CONTENT_TYPES = new Set(['text', 'image', 'file', 'video', 'audio', 'sticker'])

export function normalizeLineEvent(event: LineWebhookEvent): NormalizedLineEvent | null {
  const userId = event.source?.userId
  if (!userId) return null

  const common = {
    externalUserId: userId,
    webhookEventId: event.webhookEventId,
    isRedelivery: event.deliveryContext?.isRedelivery ?? false,
    occurredAt: new Date(event.timestamp).toISOString(),
  }

  if (event.type === 'follow' || event.type === 'unfollow') {
    return {
      ...common,
      kind: event.type,
      externalMessageId: event.webhookEventId,
      contentType: 'system',
      body: null,
      payload: {},
    }
  }

  if (event.type === 'message' && event.message) {
    const message = event.message
    if (!MESSAGE_CONTENT_TYPES.has(message.type)) return null

    if (message.type === 'text') {
      return {
        ...common,
        kind: 'message',
        externalMessageId: message.id,
        contentType: 'text',
        body: message.text ?? '',
        payload: {},
      }
    }

    // 非テキスト: バイナリ本体は保存せず content 参照だけ残す（取得はStage 2）
    const payload: Record<string, unknown> = {
      lineMessageId: message.id,
      contentProvider: message.contentProvider?.type ?? 'line',
    }
    if (message.fileName) payload.fileName = message.fileName
    if (message.fileSize) payload.fileSize = message.fileSize

    return {
      ...common,
      kind: 'message',
      externalMessageId: message.id,
      contentType: message.type as NormalizedLineEvent['contentType'],
      body: null,
      payload,
    }
  }

  return null
}
