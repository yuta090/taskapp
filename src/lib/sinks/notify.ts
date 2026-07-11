import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'
import { formatDateToLocalString } from '@/lib/gantt/dateUtils'

/**
 * sinkがconsecutive_failures>20でstatus='error'になった際のorg内部向け通知（§2-2）。
 *
 * notifications表はspace_id NOT NULLだが、sinkはorg全体スコープ(group_id=NULL)もあり得るため
 * 自然なspaceが無い。org内で最も古いspaceを便宜上の入れ物として使う
 * （通知ベルに表示するためだけで、業務的な意味は持たせない。真にorg横断の通知置き場が
 * 必要になった場合はnotifications表のスキーマ拡張を別途検討する。本PRのスコープ外の判断）。
 *
 * dedupe_keyに日付を含めることで、再有効化→再エラーの日をまたぐ再発は別通知として届く
 * （file_uploaded等の既存notificationsと同様、同日中の重複だけを防ぐ設計）。
 */
export async function notifySinkBecameError(sinkId: string, orgId: string): Promise<void> {
  const client = createAdminClient() as SupabaseClient

  const [{ data: sink }, { data: space }, { data: admins }] = await Promise.all([
    client.from('integration_sinks').select('display_name').eq('id', sinkId).maybeSingle(),
    client.from('spaces').select('id').eq('org_id', orgId).order('created_at', { ascending: true }).limit(1).maybeSingle(),
    client.from('org_memberships').select('user_id').eq('org_id', orgId).in('role', ['owner', 'admin']),
  ])

  if (!space) {
    console.error('notifySinkBecameError: org has no space to attach the notification to', orgId)
    return
  }

  const recipients = ((admins as Array<{ user_id: string }> | null) ?? []).map((m) => m.user_id)
  if (recipients.length === 0) return

  const displayName = (sink as { display_name?: string } | null)?.display_name ?? '連携シンク'
  const dayBucket = formatDateToLocalString(new Date())

  const rows = recipients.map((toUserId) => ({
    org_id: orgId,
    space_id: (space as { id: string }).id,
    to_user_id: toUserId,
    channel: 'in_app',
    type: 'sink_error',
    dedupe_key: `sink_error:${sinkId}:${dayBucket}`,
    payload: {
      sink_id: sinkId,
      title: '連携: 配達エラーが続いています',
      message: `「${displayName}」への配達が20回連続で失敗したため停止しました。設定を確認してください。`,
      link: `/${orgId}/secretary`,
    },
  }))

  const { error } = await client.from('notifications').insert(rows)
  if (error) {
    // ベストエフォート: 通知に失敗してもdispatcher本体は継続させる
    console.error('notifySinkBecameError: insert failed', error)
  }
}
