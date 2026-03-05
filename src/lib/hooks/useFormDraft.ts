'use client'

import { useState, useCallback, useRef, useSyncExternalStore } from 'react'

const DRAFT_PREFIX = 'taskapp_draft_'
const DEBOUNCE_MS = 500

interface UseFormDraftOptions {
  /** localStorage key suffix */
  key: string
  /** Only save/restore when enabled (e.g., when sheet is open) */
  enabled: boolean
}

/** Read draft from localStorage (returns null on failure) */
function readDraft<T>(storageKey: string): T | null {
  try {
    const raw = localStorage.getItem(storageKey)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

// Trivial external store for SSR — always returns true on server
const subscribe = () => () => {}
const getSnapshot = () => true
const getServerSnapshot = () => false

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
  const isMounted = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  // Lazy initial state — reads localStorage once on first render (client only)
  const [draft, setDraft] = useState<T | null>(() => {
    if (!isMounted || !enabled) return null
    return readDraft<T>(storageKey)
  })

  const restored = isMounted && enabled && draft !== null
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
  }, [storageKey])

  return { draft, restored, save, clear }
}
