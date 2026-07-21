import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'
import { pushLineMessage } from '@/lib/channels/line/client'
import { sendFreeCapUpgradeEmail } from '@/lib/email/freeCapUpgrade'

/**
 * 相手先グループに出す「中立の1行」（無料50到達時・月1回）。
 * ⚠ グループには相手先(顧客)が居るため、「無料」「上限」「アップグレード」等の気まずい語は絶対に出さない。
 *   本命の有料導線は事務所側のアプリ内通知＋メール(sendFreeCapUpgradeEmail)にだけ出す。
 */
export const FREE_CAP_GROUP_NOTICE = '📌 本日分の自動お知らせはここまでです。続きはアプリからご確認いただけます。'

export interface NudgeFreeCapReachedParams {
  orgId: string
  /** 通知を紐づけるスペース（notifications.space_id は NOT NULL）。null なら in_app 通知は省きメールのみ。 */
  spaceId: string | null
  account: { id: string; ownerType: 'org' | 'platform'; accessToken: string }
  /** 相手先グループの LINE groupId。中立1行の宛先。 */
  groupExternalId: string
  /** JST基準の 'YYYY-MM'。org×月で1回に冪等化するキー。 */
  jstMonthKey: string
  /** グローバル予算(共有account 200/月)が hard のときは、中立1行も送らない（物理上限を尊重）。 */
  globalBudgetHard: boolean
}

/**
 * 無料50通到達（org層 block×hard で digest が抑止された）ときのアップグレード促し。
 *
 * 出し分け（ユーザー方針）:
 *   - 事務所（内部 owner/admin）: アプリ内通知＋メールで **本命の有料導線**（送信枠拡大・即時・自社LINE）。
 *   - 相手先グループ: 営業文言を出さない **中立の1行** だけ（月1回）。
 *
 * org×月で1回に冪等化（org_free_cap_nudge の PK 一意で先着1件のみ本体を実行）。
 * ★ベストエフォート: 例外を投げない。促しの失敗が digest cron を壊してはいけない（抑止は既に確定済み）。
 */
export async function nudgeFreeCapReached(
  params: NudgeFreeCapReachedParams,
): Promise<{ nudged: boolean }> {
  const { orgId, spaceId, account, groupExternalId, jstMonthKey, globalBudgetHard } = params
  const client = createAdminClient() as SupabaseClient

  // 1. org×月 once ガード（先着1件だけが本体を実行する）
  try {
    const { error } = await client
      .from('org_free_cap_nudge')
      .insert({ org_id: orgId, month: jstMonthKey })
    if (error) {
      // 23505 = 一意制約違反 = 今月は既に促し済み（正常な no-op）
      if (error.code !== '23505') {
        console.error('nudgeFreeCapReached: guard insert failed', orgId, error)
      }
      return { nudged: false }
    }
  } catch (err) {
    console.error('nudgeFreeCapReached: guard insert threw', orgId, err)
    return { nudged: false }
  }

  // 2. 事務所（内部 owner/admin）へ アプリ内通知＋メール（本命の有料導線）
  await notifyAgency(client, orgId, spaceId, jstMonthKey)

  // 3. 相手先グループへ 中立の1行（営業文言なし）。グローバル物理上限が hard なら送らない。
  if (!globalBudgetHard) {
    try {
      await pushLineMessage({
        accessToken: account.accessToken,
        to: groupExternalId,
        messages: [{ type: 'text', text: FREE_CAP_GROUP_NOTICE }],
        retryKey: `free_cap_notice:${groupExternalId}:${jstMonthKey}`,
      })
    } catch (err) {
      console.error('nudgeFreeCapReached: group notice push failed', orgId, err)
    }
  }

  return { nudged: true }
}

async function notifyAgency(
  client: SupabaseClient,
  orgId: string,
  spaceId: string | null,
  monthKey: string,
): Promise<void> {
  let orgName = '貴社'
  let recipients: string[] = []
  try {
    const [{ data: org }, { data: admins }] = await Promise.all([
      client.from('organizations').select('name').eq('id', orgId).maybeSingle(),
      client
        .from('org_memberships')
        .select('user_id')
        .eq('org_id', orgId)
        .in('role', ['owner', 'admin']),
    ])
    orgName = (org as { name?: string } | null)?.name ?? orgName
    recipients = ((admins as Array<{ user_id: string }> | null) ?? []).map((m) => m.user_id)
  } catch (err) {
    console.error('nudgeFreeCapReached: resolve org/recipients failed', orgId, err)
    return
  }
  if (recipients.length === 0) return

  // in_app 通知（notifications.space_id は NOT NULL のため spaceId があるときだけ）。
  if (spaceId) {
    const rows = recipients.map((toUserId) => ({
      org_id: orgId,
      space_id: spaceId,
      to_user_id: toUserId,
      channel: 'in_app',
      type: 'free_cap_upgrade',
      dedupe_key: `free_cap_upgrade:${monthKey}`,
      payload: {
        title: '今月の無料通知枠（50通）に達しました',
        message:
          '共通LINEの自動通知が今月の上限に達し、以降は翌月まで停止します。Proにアップグレードすると、送信枠の拡大・即時通知・自社LINE（事務所名で相手先に届く）が使えます。',
        link: '/settings/billing',
      },
    }))
    try {
      const { error } = await client
        .from('notifications')
        .upsert(rows, { onConflict: 'to_user_id,channel,dedupe_key', ignoreDuplicates: true })
      if (error) console.error('nudgeFreeCapReached: in-app upsert failed', orgId, error)
    } catch (err) {
      console.error('nudgeFreeCapReached: in-app upsert threw', orgId, err)
    }
  }

  // メール（owner/admin 各人へ・本命の有料導線）
  await Promise.all(
    recipients.map(async (userId) => {
      try {
        const { data } = await client.auth.admin.getUserById(userId)
        const email = data.user?.email
        if (!email) return
        await sendFreeCapUpgradeEmail({ to: email, orgName })
      } catch (err) {
        console.error('nudgeFreeCapReached: email send failed', userId, err)
      }
    }),
  )
}
