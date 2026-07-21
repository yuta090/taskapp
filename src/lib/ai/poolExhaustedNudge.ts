import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sendPoolAiExhaustedEmail } from '@/lib/email/poolAiExhausted'

/**
 * プールAI(当社鍵)の当月org別原価上限に到達（getAiConfig が pool_quota_exhausted を投げ、
 * digest 抽出がスキップされた）ときに、事務所へ復旧導線を届ける。
 *
 * 出し分け（ユーザー方針）:
 *   - 事務所（内部 owner/admin）: アプリ内通知＋メールで「自社AIキー登録で即時復旧」。
 *   - 相手先グループ: 何も出さない。プール枯渇は Pro の内部運用事情であり、相手先(顧客)に
 *     見せる話ではない（無料50到達の中立1行のような相手先向けメッセージは存在しない）。
 *
 * org×月で1回に冪等化（org_pool_exhausted_nudge の PK 一意で先着1件のみ本体を実行）。
 * ★ベストエフォート: 例外を投げない。通知の失敗が digest cron を壊してはいけない
 *   （抽出スキップは既に確定済み・別途 skipped[] に記録される）。
 */
export interface NotifyPoolExhaustedParams {
  orgId: string
  /** 通知を紐づけるスペース（notifications.space_id は NOT NULL）。null なら in_app を省きメールのみ。 */
  spaceId: string | null
  /** JST基準の 'YYYY-MM'。org×月で1回に冪等化するキー。 */
  jstMonthKey: string
}

export async function notifyPoolExhausted(
  params: NotifyPoolExhaustedParams,
): Promise<{ nudged: boolean }> {
  const { orgId, spaceId, jstMonthKey } = params
  const client = createAdminClient() as SupabaseClient

  // 1. org×月 once ガード（先着1件だけが本体を実行する）
  try {
    const { error } = await client
      .from('org_pool_exhausted_nudge')
      .insert({ org_id: orgId, month: jstMonthKey })
    if (error) {
      // 23505 = 一意制約違反 = 今月は既に通知済み（正常な no-op）
      if (error.code !== '23505') {
        console.error('notifyPoolExhausted: guard insert failed', orgId, error)
      }
      return { nudged: false }
    }
  } catch (err) {
    console.error('notifyPoolExhausted: guard insert threw', orgId, err)
    return { nudged: false }
  }

  // 2. 事務所（内部 owner/admin）へ アプリ内通知＋メール（自社AIキー登録で即時復旧）
  await notifyAgency(client, orgId, spaceId, jstMonthKey)

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
    console.error('notifyPoolExhausted: resolve org/recipients failed', orgId, err)
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
      type: 'pool_ai_exhausted',
      dedupe_key: `pool_ai_exhausted:${monthKey}`,
      payload: {
        title: '共有AIが今月の上限に達しました',
        message:
          '共有提供しているAIが今月の利用上限に達し、チャットからの自動タスク抽出が一時停止しています。自社のAIキーを登録すると、その場で復旧します（翌月には自動的にリセットされ再開します）。',
        link: '/settings/org-integrations',
      },
    }))
    try {
      const { error } = await client
        .from('notifications')
        .upsert(rows, { onConflict: 'to_user_id,channel,dedupe_key', ignoreDuplicates: true })
      if (error) console.error('notifyPoolExhausted: in-app upsert failed', orgId, error)
    } catch (err) {
      console.error('notifyPoolExhausted: in-app upsert threw', orgId, err)
    }
  }

  // メール（owner/admin 各人へ・自社AIキー登録で即時復旧）
  await Promise.all(
    recipients.map(async (userId) => {
      try {
        const { data } = await client.auth.admin.getUserById(userId)
        const email = data.user?.email
        if (!email) return
        await sendPoolAiExhaustedEmail({ to: email, orgName })
      } catch (err) {
        console.error('notifyPoolExhausted: email send failed', userId, err)
      }
    }),
  )
}
