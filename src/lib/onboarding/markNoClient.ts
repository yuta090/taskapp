'use client'

import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * 「クライアントなしで進める」を選んだことを記録する。
 * useOnboardingFlag の markDone / markPortalPreviewSeen と同じく
 * profiles.onboarding_flags にマージ保存し、他のフラグを消さない。
 * 実際にクライアントを招待すれば done が優先されるので、取り消し操作は不要。
 */
export async function markNoClient(): Promise<void> {
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
        { id: user.id, onboarding_flags: { ...currentFlags, no_client: true } },
        { onConflict: 'id' }
      )

    if (error) throw error
  } catch (err) {
    console.warn('Failed to persist no_client flag:', err)
  }
}
