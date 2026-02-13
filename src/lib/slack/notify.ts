import type { NotificationEventType } from '@/lib/notifications/types'

interface FireNotificationParams {
  event: NotificationEventType
  taskId: string
  spaceId: string
  changes?: {
    oldStatus?: string
    newStatus?: string
    oldBall?: string
    newBall?: string
    commentBody?: string
  }
}

/**
 * Fire-and-forget 通知トリガー。
 * hooks内でタスク操作成功後に呼び出す。
 * エラーは吸収してUIに影響させない。
 */
export function fireNotification(params: FireNotificationParams): void {
  fetch('/api/slack/notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  }).catch((err) => {
    console.warn('[slack-notify] Failed:', err)
  })
}
