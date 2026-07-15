import { createClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * リクエストユーザーが superadmin か検証し、user id を返す（違えば null）。
 * admin API ルートの認可ゲート。null のとき呼び出し側は 403 を返す。
 */
export async function verifySuperadmin(): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await (supabase as SupabaseClient)
    .from('profiles')
    .select('is_superadmin')
    .eq('id', user.id)
    .single()
  return profile?.is_superadmin ? user.id : null
}
