import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'
import { formatDateToLocalString } from '@/lib/gantt/dateUtils'
import { sendGroupClaimLinkedEmail } from '@/lib/email/groupClaimLinked'

/**
 * code_only 成立時の org 通知（検知的統制・設計正本 §4/§7-8(m)・PR3b）。
 *
 * code_only は人の承認を経ずに即時紐付けが成立するため、成立の事実をorgへ知らせることが
 * 唯一の統制面になる（是正手段は unlink→新世代）。コンソール(in_app通知)＋メール（owner/admin宛）。
 *
 * ★ベストエフォート: この関数は例外を投げない設計にする。呼び出し側(webhook)は紐付けRPC成功後に
 * 別トランザクションでこれを呼ぶため、通知の失敗が既に成立した紐付けを巻き戻すことは無いし、
 * あってはならない。個々の送信失敗もログに残すのみで他の受信者への送信を止めない。
 */
export async function notifyCodeOnlyGroupLinked(
  orgId: string,
  spaceId: string,
  groupDisplayName: string | null,
): Promise<void> {
  const client = createAdminClient() as SupabaseClient

  let orgName = '貴社'
  let spaceName = 'プロジェクト'
  let recipients: string[] = []
  try {
    const [{ data: org }, { data: space }, { data: admins }] = await Promise.all([
      client.from('organizations').select('name').eq('id', orgId).maybeSingle(),
      client.from('spaces').select('name').eq('id', spaceId).maybeSingle(),
      client.from('org_memberships').select('user_id').eq('org_id', orgId).in('role', ['owner', 'admin']),
    ])
    orgName = (org as { name?: string } | null)?.name ?? orgName
    spaceName = (space as { name?: string } | null)?.name ?? spaceName
    recipients = ((admins as Array<{ user_id: string }> | null) ?? []).map((m) => m.user_id)
  } catch (err) {
    console.error('notifyCodeOnlyGroupLinked: failed to resolve org/space/recipients', orgId, err)
    return
  }

  if (recipients.length === 0) return

  const groupLabel = groupDisplayName ?? '(グループ名不明)'
  const dayBucket = formatDateToLocalString(new Date())

  const rows = recipients.map((toUserId) => ({
    org_id: orgId,
    space_id: spaceId,
    to_user_id: toUserId,
    channel: 'in_app',
    type: 'group_claim_linked',
    dedupe_key: `group_claim_linked:${spaceId}:${groupLabel}:${dayBucket}`,
    payload: {
      title: '共有botグループが紐付きました',
      message: `グループ「${groupLabel}」が「${spaceName}」に紐付きました（招待コードによる自動成立）。`,
      link: `/${orgId}/secretary/group-links`,
    },
  }))

  try {
    const { error } = await client
      .from('notifications')
      .upsert(rows, { onConflict: 'to_user_id,channel,dedupe_key', ignoreDuplicates: true })
    if (error) {
      console.error('notifyCodeOnlyGroupLinked: in-app upsert failed', error)
    }
  } catch (err) {
    console.error('notifyCodeOnlyGroupLinked: in-app upsert threw', err)
  }

  await Promise.all(
    recipients.map(async (userId) => {
      try {
        const { data } = await client.auth.admin.getUserById(userId)
        const email = data.user?.email
        if (!email) return
        await sendGroupClaimLinkedEmail({
          to: email,
          orgId,
          orgName,
          spaceName,
          groupDisplayName: groupLabel,
        })
      } catch (err) {
        console.error('notifyCodeOnlyGroupLinked: email send failed', userId, err)
      }
    }),
  )
}
