'use client'

import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Records that the current (internal) user has viewed
 * `/portal/preview/[spaceId]` at least once, following the same
 * merge-not-overwrite pattern as useOnboardingFlag's markDone so this never
 * clobbers unrelated onboarding_flags keys.
 */
export async function markPortalPreviewSeen(): Promise<void> {
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
    const { error } = await supabase
      .from('profiles')
      .update({ onboarding_flags: { ...currentFlags, portal_preview_seen: true } })
      .eq('id', user.id)

    if (error) throw error
  } catch (err) {
    console.warn('Failed to persist portal_preview_seen flag:', err)
  }
}
