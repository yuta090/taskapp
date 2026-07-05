'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'

export type OnboardingFlagKey = 'internal_walkthrough' | 'portal_walkthrough' | 'setup_checklist'

export interface UseOnboardingFlagResult {
  /** null while still checking; true = show the walkthrough, false = already done */
  shouldShow: boolean | null
  markDone: () => Promise<void>
}

/**
 * Server-persisted onboarding walkthrough flag, backed by `profiles.onboarding_flags`
 * with a localStorage fallback.
 *
 * localStorage is checked first and short-circuits to shouldShow=false without a
 * server round-trip — E2E fixtures (tests/e2e/fixtures.ts, global-setup.ts) rely on
 * this to suppress the walkthrough in test runs. When localStorage has not seen it,
 * the server flag is consulted so completion survives across devices/browsers. Any
 * failure to read the server flag (including the column not existing yet on an
 * unmigrated environment) falls back to "not yet seen".
 */
export function useOnboardingFlag(
  key: OnboardingFlagKey,
  localStorageKey: string
): UseOnboardingFlagResult {
  const [shouldShow, setShouldShow] = useState<boolean | null>(null)
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()

  const isLocallyDone = useCallback(() => {
    try {
      return localStorage.getItem(localStorageKey) === 'true'
    } catch {
      return false
    }
  }, [localStorageKey])

  useEffect(() => {
    let cancelled = false

    async function check() {
      if (isLocallyDone()) {
        if (!cancelled) setShouldShow(false)
        return
      }

      try {
        const supabase = supabaseRef.current as SupabaseClient
        const { data: { user }, error: userError } = await supabase.auth.getUser()
        if (userError || !user) {
          if (!cancelled) setShouldShow(true)
          return
        }

        const { data, error } = await supabase
          .from('profiles')
          .select('onboarding_flags')
          .eq('id', user.id)
          .single<{ onboarding_flags: Record<string, boolean> }>()

        if (error) {
          if (!cancelled) setShouldShow(true)
          return
        }

        const flags = data?.onboarding_flags ?? {}
        if (!cancelled) setShouldShow(flags[key] !== true)
      } catch {
        if (!cancelled) setShouldShow(true)
      }
    }

    void check()
    return () => {
      cancelled = true
    }
  }, [key, isLocallyDone])

  const markDone = useCallback(async () => {
    try {
      localStorage.setItem(localStorageKey, 'true')
    } catch {
      // localStorage unavailable (private browsing, etc.) — server write still attempted below
    }

    try {
      const supabase = supabaseRef.current as SupabaseClient
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
        .update({ onboarding_flags: { ...currentFlags, [key]: true } })
        .eq('id', user.id)

      if (error) throw error
    } catch (err) {
      console.warn('Failed to persist onboarding flag to server:', err)
    }
  }, [key, localStorageKey])

  return { shouldShow, markDone }
}

/**
 * Clears a server-persisted onboarding flag so the walkthrough shows again
 * next time `shouldShow` is checked. Used by "reset"/"show guide again"
 * actions (e.g. LeftNav, PortalHeader), which fire outside of any live
 * `useOnboardingFlag` instance and so cannot call `markDone`'s inverse
 * through hook state.
 */
export async function resetOnboardingFlagOnServer(key: OnboardingFlagKey): Promise<void> {
  try {
    const supabase = createClient() as SupabaseClient
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) return

    const { data } = await supabase
      .from('profiles')
      .select('onboarding_flags')
      .eq('id', user.id)
      .single<{ onboarding_flags: Record<string, boolean> }>()

    const rest = { ...(data?.onboarding_flags ?? {}) }
    delete rest[key]
    const { error } = await supabase
      .from('profiles')
      .update({ onboarding_flags: rest })
      .eq('id', user.id)

    if (error) throw error
  } catch (err) {
    console.warn('Failed to reset onboarding flag on server:', err)
  }
}
