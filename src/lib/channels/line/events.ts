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

interface LinePostbackPayload {
  data: string
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
  postback?: LinePostbackPayload
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

export type NormalizedEventKind =
  | 'message'
  | 'follow'
  | 'unfollow'
  | 'join'
  | 'leave'
  | 'room_join'
  | 'postback'

export interface NormalizedLineEvent {
  kind: NormalizedEventKind
  /** 1:1のLINE userId。グループの匿名メンバー発言では null */
  externalUserId: string | null
  /** グループ発言・グループ系イベント(join/leave/postback)の場合のみ */
  groupId?: string
  /** room招待（Stage 2非サポート）の場合のみ */
  roomId?: string
  /** kind='postback' の場合のみ: postback.data そのまま */
  postbackData?: string
  /** reply送信用（通数無料）。イベントに無ければ undefined */
  replyToken?: string
  /** message イベントは message.id、それ以外は webhookEventId */
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
  const source = event.source
  const userId = source?.userId ?? null
  const groupId = source?.type === 'group' ? source.groupId : undefined
  const roomId = source?.type === 'room' ? source.roomId : undefined

  const common = {
    externalUserId: userId,
    webhookEventId: event.webhookEventId,
    isRedelivery: event.deliveryContext?.isRedelivery ?? false,
    occurredAt: new Date(event.timestamp).toISOString(),
    replyToken: event.replyToken,
  }
  const systemCommon = {
    externalMessageId: event.webhookEventId,
    contentType: 'system' as const,
    body: null,
    payload: {},
  }

  if (event.type === 'join') {
    // room招待は非サポート: 案内を送って退出するため system イベントとしてのみ扱う
    if (source?.type === 'room' && roomId) {
      return { ...common, ...systemCommon, kind: 'room_join', roomId }
    }
    if (source?.type === 'group' && groupId) {
      return { ...common, ...systemCommon, kind: 'join', groupId }
    }
    return null
  }

  if (event.type === 'leave') {
    if (source?.type === 'group' && groupId) {
      return { ...common, ...systemCommon, kind: 'leave', groupId }
    }
    return null
  }

  if (event.type === 'postback') {
    if (!event.postback?.data) return null
    return { ...common, ...systemCommon, kind: 'postback', groupId, postbackData: event.postback.data }
  }

  if (event.type === 'follow' || event.type === 'unfollow') {
    // 1:1のみ（グループはfollow/unfollowを発行しない）
    if (!userId) return null
    return { ...common, ...systemCommon, kind: event.type }
  }

  if (event.type === 'message' && event.message) {
    // room（複数人トーク）のメッセージは非サポート。1:1とグループのみ扱う
    if (source?.type !== 'user' && source?.type !== 'group') return null
    // 1:1は userId 必須。グループは匿名メンバーの発言を許容する
    if (source.type === 'user' && !userId) return null

    const message = event.message
    if (!MESSAGE_CONTENT_TYPES.has(message.type)) return null

    if (message.type === 'text') {
      return {
        ...common,
        kind: 'message',
        groupId,
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
      groupId,
      externalMessageId: message.id,
      contentType: message.type as NormalizedLineEvent['contentType'],
      body: null,
      payload,
    }
  }

  return null
}
