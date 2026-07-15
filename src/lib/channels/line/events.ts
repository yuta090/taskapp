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

interface LineMentionee {
  index: number
  length: number
  /** 'user' = 個人宛 / 'all' = @all（全員宛。指名ではないので担当と見なさない） */
  type: string
  /**
   * メンションされたユーザーのLINE userId。
   * type='user' かつ本人がプロフィール取得に同意している場合のみ含まれる。
   * 未同意のメンバーをメンションしても来ないため、常に取れる前提は置けない（Stage 2.6 §1-1）。
   */
  userId?: string
  isSelf?: boolean
}

interface LineMessagePayload {
  id: string
  type: string
  text?: string
  contentProvider?: { type: string }
  fileName?: string
  fileSize?: number
  duration?: number
  mention?: { mentionees: LineMentionee[] }
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

export interface AssigneeMention {
  index: number
  length: number
  /** プロフィール取得に同意していないメンバーは null（表示名だけで運用する） */
  userId: string | null
  /** 本文のメンション区間から切り出した表示名（先頭の @ は落とす） */
  displayName: string
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
  /** 発生元の種別。承認postbackを1:1限定にゲートする等、文脈判定に使う */
  sourceType?: 'user' | 'group' | 'room'
  /** 1:1のLINE userId。グループの匿名メンバー発言では null */
  externalUserId: string | null
  /** グループ発言・グループ系イベント(join/leave/postback)の場合のみ */
  groupId?: string
  /** room招待（Stage 2非サポート）の場合のみ */
  roomId?: string
  /** kind='postback' の場合のみ: postback.data そのまま */
  postbackData?: string
  /** text メッセージが自bot宛メンションを含む場合のみ true（Stage 2.5 §2 mention_only判定用） */
  mentionsSelf?: boolean
  /** mentionsSelf=true のときの自分宛メンション区間（本文からメンション文字列を除去するため） */
  selfMentionSpans?: Array<{ index: number; length: number }>
  /**
   * 他人宛メンション（Stage 2.6 §3）: 申し送りの担当決定に使う。
   * userId は本人が未同意なら null になるため、表示名（本文のメンション区間から切り出し）を常に持つ。
   * @all は指名ではないため含めない。
   */
  assigneeMentions?: AssigneeMention[]
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

/**
 * 本文のメンション区間から表示名を切り出す（'@山田' → '山田'）。
 * LINEはメンション対象の表示名を別フィールドで返さないため、本文の [index, length) を切る以外に手段がない。
 * userId が取れない（プロフィール取得未同意）メンバーは、この表示名だけが担当の手がかりになる。
 */
function extractMentionDisplayName(text: string, index: number, length: number): string {
  return text.slice(index, index + length).replace(/^@/, '').trim()
}

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
    // sourceType/roomId を保持する。承認postback(Stage 2.7-B)は 1:1 限定にゲートするため、
    // group/room 由来かどうかを後段で判別できる必要がある。
    const sourceType = source?.type as 'user' | 'group' | 'room' | undefined
    return { ...common, ...systemCommon, kind: 'postback', sourceType, groupId, roomId, postbackData: event.postback.data }
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
      const mentionees = message.mention?.mentionees ?? []
      const text = message.text ?? ''

      const selfMentionSpans = mentionees
        .filter((m) => m.isSelf === true)
        .map((m) => ({ index: m.index, length: m.length }))
      const mentionsSelf = selfMentionSpans.length > 0

      // 他人宛メンション = 担当の指名（Stage 2.6）。@all は全員宛で指名ではないため除く
      const assigneeMentions = mentionees
        .filter((m) => m.isSelf !== true && m.type === 'user')
        .map((m) => ({
          index: m.index,
          length: m.length,
          userId: m.userId ?? null,
          displayName: extractMentionDisplayName(text, m.index, m.length),
        }))

      const payload: Record<string, unknown> = {}
      if (mentionsSelf) payload.mentionsSelf = true
      // 夜間一括抽出（allモード）は生イベントを見られないため、担当の復元にはpayloadが唯一の手がかり
      if (assigneeMentions.length > 0) payload.mentionees = assigneeMentions

      return {
        ...common,
        kind: 'message',
        groupId,
        externalMessageId: message.id,
        contentType: 'text',
        body: text,
        payload,
        ...(mentionsSelf ? { mentionsSelf, selfMentionSpans } : {}),
        ...(assigneeMentions.length > 0 ? { assigneeMentions } : {}),
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
