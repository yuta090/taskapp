'use client'

import { useEffect, useCallback } from 'react'

type ShortcutHandler = () => void

interface Shortcut {
  key: string
  handler: ShortcutHandler
  /** Ctrl/Cmd modifier required */
  meta?: boolean
  /** 入力フィールドにフォーカス中でも発火する */
  allowInInput?: boolean
}

/**
 * キーボードショートカットを登録するフック
 *
 * 入力フィールド（input/textarea/[contenteditable]）にフォーカス中は
 * allowInInput: true のショートカット以外は無視される。
 */
export function useKeyboardShortcuts(shortcuts: Shortcut[]) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const isInput =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable

      for (const shortcut of shortcuts) {
        const metaMatch = shortcut.meta
          ? e.metaKey || e.ctrlKey
          : !e.metaKey && !e.ctrlKey && !e.altKey

        if (e.key === shortcut.key && metaMatch) {
          if (isInput && !shortcut.allowInInput) continue
          e.preventDefault()
          shortcut.handler()
          return
        }
      }
    },
    [shortcuts]
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])
}
