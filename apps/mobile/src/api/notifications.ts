/**
 * 受信トレイ（Web の useNotifications と同じ問い合わせ・同じ件数）。
 */
import { INBOX_RECENT_LIMIT, INBOX_UNREAD_LIMIT } from '@/lib/notifications/inboxLimits'
import { mergeNewestFirst, type InboxRow } from '~/lib/inbox'
import { supabase } from './supabase'

export async function fetchInbox(userId: string, orgId: string): Promise<InboxRow[]> {
  const base = () =>
    supabase
      .from('notifications')
      .select('*, spaces(name)')
      .eq('to_user_id', userId)
      .eq('channel', 'in_app')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
  const [recent, unread] = await Promise.all([
    base().limit(INBOX_RECENT_LIMIT),
    base().is('read_at', null).limit(INBOX_UNREAD_LIMIT),
  ])
  if (recent.error) throw recent.error
  if (unread.error) throw unread.error
  return mergeNewestFirst(
    (recent.data ?? []) as unknown as InboxRow[],
    (unread.data ?? []) as unknown as InboxRow[]
  )
}

export async function markRead(notificationId: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId)
  if (error) throw error
}

export async function markAllRead(userId: string, orgId: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('to_user_id', userId)
    .eq('channel', 'in_app')
    .eq('org_id', orgId)
    .is('read_at', null)
  if (error) throw error
}
