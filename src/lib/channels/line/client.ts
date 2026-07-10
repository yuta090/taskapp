/**
 * LINE Messaging API クライアント（push送信）。
 * サーバー専用 — channel access token を扱うため client component から import しない。
 */

export interface LineTextMessage {
  type: 'text'
  text: string
}

/** 日次digestの消し込みボタン用。contentsの中身は @/lib/channels/digest/compute で組み立てる */
export interface LineFlexMessage {
  type: 'flex'
  altText: string
  contents: unknown
}

export type LineMessage = LineTextMessage | LineFlexMessage

export class LinePushError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'LinePushError'
    this.status = status
  }
}

const LINE_PUSH_ENDPOINT = 'https://api.line.me/v2/bot/message/push'

export interface PushLineMessageParams {
  accessToken: string
  /** LINE userId (Uで始まる) */
  to: string
  messages: LineMessage[]
  /** UUID。指定すると再試行時にLINE側で二重配信を防ぐ */
  retryKey?: string
}

export async function pushLineMessage(params: PushLineMessageParams): Promise<void> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${params.accessToken}`,
  }
  if (params.retryKey) {
    headers['X-Line-Retry-Key'] = params.retryKey
  }

  const response = await fetch(LINE_PUSH_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify({ to: params.to, messages: params.messages }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new LinePushError(response.status, `LINE push failed (${response.status}): ${body}`)
  }
}

const LINE_REPLY_ENDPOINT = 'https://api.line.me/v2/bot/message/reply'

export interface ReplyLineMessageParams {
  accessToken: string
  replyToken: string
  messages: LineMessage[]
}

/**
 * reply API。push と異なり通数を消費しないため、消し込み確認・紐付け確認は必ずこちらを使う。
 */
export async function replyLineMessage(params: ReplyLineMessageParams): Promise<void> {
  const response = await fetch(LINE_REPLY_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    },
    body: JSON.stringify({ replyToken: params.replyToken, messages: params.messages }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new LinePushError(response.status, `LINE reply failed (${response.status}): ${body}`)
  }
}

/**
 * room（複数人トーク）からの退出。Stage 2ではroomは非サポートのため、
 * join直後に案内を送ってこのAPIで退出する。グループの退出とはエンドポイントが異なる。
 */
export async function leaveRoom(accessToken: string, roomId: string): Promise<void> {
  const response = await fetch(`https://api.line.me/v2/bot/room/${roomId}/leave`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new LinePushError(response.status, `LINE room leave failed (${response.status}): ${body}`)
  }
}

const LINE_CONTENT_ENDPOINT = 'https://api-data.line.me/v2/bot/message'

export interface LineMessageContent {
  data: ArrayBuffer
  contentType: string
}

/**
 * 添付コンテンツの取得。LINE側は一定期間で消えるため受信時に呼び、Storageへ保存する。
 */
export async function fetchLineMessageContent(
  accessToken: string,
  messageId: string,
): Promise<LineMessageContent> {
  const response = await fetch(`${LINE_CONTENT_ENDPOINT}/${messageId}/content`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    throw new LinePushError(
      response.status,
      `LINE content fetch failed (${response.status}) for message ${messageId}`,
    )
  }

  return {
    data: await response.arrayBuffer(),
    contentType: response.headers.get('Content-Type') ?? 'application/octet-stream',
  }
}
