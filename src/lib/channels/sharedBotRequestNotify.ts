import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sendSharedBotAccessRequestedEmail } from '@/lib/email/sharedBotAccessRequested'

/**
 * 共通LINE(共有Bot)の利用申込が入ったことを、運営(superadmin)全員へメールで知らせる。
 *
 * ⚠ なぜ必要か: 申込API は org_channel_policy を none→requested に変えるだけで、
 *   **通知が一切無かった**。運営が /admin/shared-bot-access を自分で開きに行かない限り
 *   誰も気づかず、「申し込んだのに音沙汰が無い」で顧客を失う（しかも失注理由すら分からない）。
 *
 * 宛先は profiles.is_superadmin = true の全員。**管理者は複数登録できる**ので、
 * 1人が不在でも開通が止まらないようにする（単一障害点の解消）。
 *
 * チャネルはメールのみ。アプリ内通知(notifications)は org×space に紐づく設計で、
 * superadmin は申込元orgのメンバーではないため受け取れない。運営の pull 導線は
 * 承認キュー画面(/admin/shared-bot-access)が既にある＝メールは push 側の役割。
 *
 * ★ベストエフォート: 例外を投げない。通知の失敗で申込API自体を落としてはいけない
 *   （申込の記録はもう確定している）。
 * ★冪等性: 呼び出し側が「none→requested に実際に遷移したときだけ」呼ぶ契約。
 *   既に requested/granted の再申込では呼ばれないので、ここでガードは持たない。
 */
export interface NotifySharedBotAccessRequestedParams {
  orgId: string
}

export async function notifySharedBotAccessRequested(
  params: NotifySharedBotAccessRequestedParams,
): Promise<{ notified: number }> {
  const { orgId } = params
  const client = createAdminClient() as SupabaseClient

  let orgName = '(名称不明の組織)'
  let adminIds: string[] = []
  try {
    const [{ data: org }, { data: admins }] = await Promise.all([
      client.from('organizations').select('name').eq('id', orgId).maybeSingle(),
      client.from('profiles').select('id').eq('is_superadmin', true),
    ])
    orgName = (org as { name?: string } | null)?.name ?? orgName
    adminIds = ((admins as Array<{ id: string }> | null) ?? []).map((a) => a.id)
  } catch (err) {
    console.error('notifySharedBotAccessRequested: resolve org/superadmins failed', orgId, err)
    return { notified: 0 }
  }

  if (adminIds.length === 0) {
    // 運営が1人も登録されていない = 申込が誰にも届かない。運用事故なので必ずログに残す。
    console.error('notifySharedBotAccessRequested: no superadmin registered — request will go unnoticed', orgId)
    return { notified: 0 }
  }

  const results = await Promise.all(
    adminIds.map(async (userId) => {
      try {
        const { data } = await client.auth.admin.getUserById(userId)
        const email = data.user?.email
        if (!email) return false
        await sendSharedBotAccessRequestedEmail({ to: email, orgName, orgId })
        return true
      } catch (err) {
        console.error('notifySharedBotAccessRequested: email send failed', userId, err)
        return false
      }
    }),
  )

  return { notified: results.filter(Boolean).length }
}
