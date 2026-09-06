'use client'

import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'

/** profiles.onboarding_flags に立てられる「選択」フラグ（チェックリストのスキップ系）。 */
export type OnboardingChoiceFlag = 'no_client' | 'skip_line' | 'skip_ai'

/**
 * profiles.onboarding_flags にフラグを1つマージ保存する（他のフラグは消さない）。
 * 「クライアントなし」「この設定はしない（LINE / AI）」の共通実装。
 * 実際に招待・連携・設定が済めば done が優先されるので、取り消し操作は不要。
 * 失敗しても UI を止めない（警告ログのみ）。
 */
export async function setOnboardingFlag(flag: OnboardingChoiceFlag): Promise<void> {
  try {
    const supabase = createClient() as SupabaseClient
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) return

    const { data } = await supabase
      .from('profiles')
      .select('onboarding_flags')
      .eq('id', user.id)
      .single<{ onboarding_flags: Record<string, boolean> }>()

    const currentFlags = data?.onboarding_flags ?? {}
    // upsert (not update) — the profiles row may not exist yet if the
    // on_auth_user_created trigger hasn't run, in which case update() would
    // silently no-op (0 rows affected).
    const { error } = await supabase
      .from('profiles')
      .upsert(
        { id: user.id, onboarding_flags: { ...currentFlags, [flag]: true } },
        { onConflict: 'id' }
      )

    if (error) throw error
  } catch (err) {
    console.warn(`Failed to persist ${flag} flag:`, err)
  }
}
