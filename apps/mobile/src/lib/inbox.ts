/**
 * 受信トレイの1行に出す中身。
 *
 * 見出しと本文は Web のプッシュ通知（buildPushMessage）と同じものを使う。
 * スマホに届いた通知と、アプリを開いたときの一覧の文面をそろえるため。
 */
import { buildPushMessage, type PushNotificationRow } from '@/lib/push/buildPushMessage'
import { isActionableNotification } from '@/lib/notifications/classify'

export interface InboxRow extends PushNotificationRow {
  created_at: string
  read_at: string | null
  actioned_at: string | null
  spaces?: { name: string } | null
}

export interface InboxItem {
  id: string
  title: string
  body: string
  taskId: string | null
  spaceName: string | null
  createdAt: string
  unread: boolean
  /** 自分が何かする必要がある通知で、まだ対応していない */
  needsAction: boolean
}

export function toInboxItem(row: InboxRow): InboxItem {
  // アプリを使うのは社内の人（相手先は Web のポータル）なので internal で文面を作る
  const message = buildPushMessage(row, 'internal')
  return {
    id: row.id,
    title: message.title,
    body: message.body,
    taskId: row.payload.task_id ?? null,
    spaceName: row.spaces?.name ?? null,
    createdAt: row.created_at,
    unread: row.read_at === null,
    needsAction: isActionableNotification(row.type) && row.actioned_at === null,
  }
}

/** 新着と未読をまとめる（両方にあれば1件に）。新しい順。Web の useNotifications と同じ規則 */
export function mergeNewestFirst<T extends { id: string; created_at: string }>(recent: T[], unread: T[]): T[] {
  const byId = new Map<string, T>()
  for (const n of [...recent, ...unread]) {
    if (!byId.has(n.id)) byId.set(n.id, n)
  }
  return [...byId.values()].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
}
