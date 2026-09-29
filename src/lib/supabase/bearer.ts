import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * 利用者のアクセストークン（Authorization: Bearer）で DB に問い合わせるクライアント（server 専用）。
 * スマホアプリからのリクエスト用。問い合わせには RLS がそのまま効く（service role ではない）。
 * セッションは持たない（保存も更新もしない）。使うのは src/lib/supabase/routeAuth.ts だけ。
 */
export function createBearerClient(accessToken: string): SupabaseClient<Database> {
  return createSupabaseClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}
