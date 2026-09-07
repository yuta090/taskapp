import { createClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { checkAal2, type Aal2Check } from '@/lib/auth/requireAal2'

export type SuperadminVerdict =
  | { ok: true; userId: string; enrolled: boolean }
  | { ok: false; reason: 'unauthenticated' | 'not_superadmin' | Exclude<Aal2Check, { ok: true }>['reason']; userId?: string }

/** 運営画面で「二要素認証を登録していない運営」も締め出すか（登録が済んでから true にする） */
export function isAdminMfaRequired(): boolean {
  return process.env.ADMIN_MFA_REQUIRED === 'true'
}

/**
 * リクエストユーザーが superadmin で、かつ二要素認証の条件を満たすか（理由つき）。
 * - 登録済みの運営は、コード入力済み(aal2)でなければ拒否（画面の門番とは別に、API 側で本当に強制する）
 * - ADMIN_MFA_REQUIRED=true なら未登録の運営も拒否
 */
export async function verifySuperadminDetailed(): Promise<SuperadminVerdict> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, reason: 'unauthenticated' }
  const { data: profile } = await (supabase as SupabaseClient).from('profiles').select('is_superadmin').eq('id', user.id).single()
  if (!profile?.is_superadmin) return { ok: false, reason: 'not_superadmin', userId: user.id }
  const aal = await checkAal2(supabase as SupabaseClient, { strict: isAdminMfaRequired() })
  if (!aal.ok) return { ok: false, reason: aal.reason, userId: user.id }
  return { ok: true, userId: user.id, enrolled: aal.enrolled }
}

/**
 * admin API ルートの認可ゲート。superadmin かつ二要素認証の条件を満たすとき user id、違えば null（呼び出し側は 403）。
 */
export async function verifySuperadmin(): Promise<string | null> {
  const v = await verifySuperadminDetailed()
  return v.ok ? v.userId : null
}
