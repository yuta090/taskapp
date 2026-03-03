'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

const DRAFT_PREFIX = 'taskapp_draft_'
const DEBOUNCE_MS = 500

interface UseFormDraftOptions {
  /** localStorage key suffix */
  key: string
  /** Only save/restore when enabled (e.g., when sheet is open) */
  enabled: boolean
}

/**
 * フォーム下書きの自動保存フック
 *
 * - enabled=true 時に localStorage から復元を試みる
 * - save() でデバウンス付き保存
 * - clear() で下書きを削除（送信成功時に呼ぶ）
 */
export function useFormDraft<T>(options: UseFormDraftOptions) {
  const { key, enabled } = options
  const storageKey = DRAFT_PREFIX + key
  const [draft, setDraft] = useState<T | null>(null)
  const [restored, setRestored] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Restore draft when enabled transitions to true
  useEffect(() => {
    if (!enabled) {
      setRestored(false)
      return
    }

    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) {
        const parsed = JSON.parse(raw) as T
        setDraft(parsed)
        setRestored(true)
      } else {
        setDraft(null)
        setRestored(false)
      }
    } catch {
      setDraft(null)
      setRestored(false)
    }
  }, [enabled, storageKey])

  const save = useCallback(
    (data: T) => {
      if (!enabled) return
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        try {
          localStorage.setItem(storageKey, JSON.stringify(data))
        } catch {
          // localStorage full or unavailable — silently ignore
        }
      }, DEBOUNCE_MS)
    },
    [enabled, storageKey]
  )

  const clear = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    try {
      localStorage.removeItem(storageKey)
    } catch {
      // ignore
    }
    setDraft(null)
    setRestored(false)
  }, [storageKey])

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return { draft, restored, save, clear }
}
