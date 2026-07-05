'use client'

import { useCallback, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface UseReminderPreferenceResult {
  enabled: boolean
  toggle: () => Promise<void>
  saving: boolean
}

/**
 * クライアント滞留リマインドメールの受信可否 (profiles.reminder_emails_enabled)。
 * 保存ボタンは無く、トグル操作で即座に楽観的更新 → 失敗時はロールバックする
 * (プロジェクト規約: 保存ボタン無しの楽観的更新必須)。
 */
export function useReminderPreference(
  userId: string,
  initialEnabled: boolean
): UseReminderPreferenceResult {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [saving, setSaving] = useState(false)
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()

  const toggle = useCallback(async () => {
    const previous = enabled
    const next = !previous
    setEnabled(next)
    setSaving(true)

    try {
      const supabase = supabaseRef.current as SupabaseClient
      const { error } = await supabase
        .from('profiles')
        .update({ reminder_emails_enabled: next })
        .eq('id', userId)

      if (error) throw error
    } catch (err) {
      console.warn('Failed to persist reminder email preference:', err)
      setEnabled(previous)
    } finally {
      setSaving(false)
    }
  }, [enabled, userId])

  return { enabled, toggle, saving }
}
