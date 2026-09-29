/**
 * スマホアプリ（apps/mobile）へのプッシュ通知を Expo のプッシュ API で送る。
 *
 * /api/push/dispatch が Web Push と一緒に呼ぶ。鳴らすかどうか（種類・時間帯・1日の上限・本人の設定）は
 * 呼ぶ側で決め終わっている。ここは送るだけ。
 *
 * 失敗しても投げない（同じリクエストで送る Web Push を巻き込まない）。端末からアプリが消えた
 * （DeviceNotRegistered）ときだけ、その行を消すよう staleIds で返す。
 * 既知の穴: DeviceNotRegistered が送信時ではなく後の「受領確認」でだけ返る場合があるが、受領確認は照会していない。
 */
import type { PushMessage, PushNotificationRow } from '@/lib/push/buildPushMessage'
import { QUIET_HOURS_EXEMPT_TYPES } from '@/lib/notifications/delivery'

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'
/** Expo の1回の送信に載せられる上限 */
const CHUNK_SIZE = 100
const TIMEOUT_MS = 10_000

export interface MobilePushTokenRow {
  id: string
  token: string
}

export interface ExpoMessage {
  to: string
  title: string
  body: string
  sound: 'default'
  priority: 'default' | 'high'
  channelId: 'default'
  data: { notificationId: string; taskId: string | null; type: string }
}

export interface ExpoSendResult {
  sent: number
  failed: number
  /** 送れた行（last_used_at を更新する） */
  usedIds: string[]
  /** 端末からアプリが消えていた行（消す） */
  staleIds: string[]
}

interface ExpoTicket {
  status?: string
  details?: { error?: string }
}

export function buildExpoMessage(token: string, notification: PushNotificationRow, message: PushMessage): ExpoMessage {
  return {
    to: token,
    title: message.title,
    body: message.body,
    sound: 'default',
    priority: QUIET_HOURS_EXEMPT_TYPES.includes(notification.type) ? 'high' : 'default',
    channelId: 'default',
    data: { notificationId: notification.id, taskId: notification.payload.task_id ?? null, type: notification.type },
  }
}

export async function sendExpoPush(
  tokens: MobilePushTokenRow[],
  notification: PushNotificationRow,
  message: PushMessage,
  options: { accessToken?: string; fetchImpl?: typeof fetch } = {}
): Promise<ExpoSendResult> {
  const result: ExpoSendResult = { sent: 0, failed: 0, usedIds: [], staleIds: [] }
  const fetchImpl = options.fetchImpl ?? fetch

  for (let i = 0; i < tokens.length; i += CHUNK_SIZE) {
    const chunk = tokens.slice(i, i + CHUNK_SIZE)
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' }
    if (options.accessToken) headers.Authorization = `Bearer ${options.accessToken}`

    let tickets: ExpoTicket[] | null = null
    try {
      const res = await fetchImpl(EXPO_PUSH_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(chunk.map((row) => buildExpoMessage(row.token, notification, message))),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (res.ok) {
        const json = (await res.json()) as { data?: unknown }
        tickets = Array.isArray(json.data) ? (json.data as ExpoTicket[]) : null
      } else {
        console.error('[push/expo] Expo push API returned', res.status)
      }
    } catch (err) {
      console.error('[push/expo] Failed to call Expo push API:', err)
    }

    chunk.forEach((row, index) => {
      const ticket = tickets?.[index]
      if (ticket?.status === 'ok') {
        result.sent += 1
        result.usedIds.push(row.id)
        return
      }
      result.failed += 1
      if (ticket?.details?.error === 'DeviceNotRegistered') result.staleIds.push(row.id)
    })
  }

  return result
}
