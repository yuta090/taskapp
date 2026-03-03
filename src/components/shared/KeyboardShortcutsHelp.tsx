'use client'

import { useState, useCallback } from 'react'
import { X, Keyboard } from '@phosphor-icons/react'
import { useFocusTrap } from '@/lib/hooks/useFocusTrap'
import { useKeyboardShortcuts } from '@/lib/hooks/useKeyboardShortcuts'

const SHORTCUTS = [
  { keys: ['N'], description: '新規タスク作成' },
  { keys: ['/'], description: 'タスク検索にフォーカス' },
  { keys: ['?'], description: 'ショートカット一覧' },
  { keys: ['Esc'], description: 'パネルを閉じる / 選択解除' },
]

export function useShortcutsHelp() {
  const [isOpen, setIsOpen] = useState(false)
  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])

  useKeyboardShortcuts([
    { key: '?', handler: () => setIsOpen((v) => !v) },
  ])

  const ShortcutsHelp = isOpen ? (
    <ShortcutsHelpDialog onClose={close} />
  ) : null

  return { ShortcutsHelp, openShortcutsHelp: open }
}

function ShortcutsHelpDialog({ onClose }: { onClose: () => void }) {
  const focusTrapRef = useFocusTrap<HTMLDivElement>({ enabled: true, onClose })

  return (
    <div ref={focusTrapRef} className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 animate-backdrop-in" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-white rounded-xl shadow-xl animate-dialog-in">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
            <Keyboard className="text-base" />
            キーボードショートカット
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
            aria-label="閉じる"
          >
            <X className="text-lg" />
          </button>
        </div>
        <div className="p-4 space-y-2">
          {SHORTCUTS.map((s) => (
            <div key={s.description} className="flex items-center justify-between py-1.5">
              <span className="text-sm text-gray-600">{s.description}</span>
              <div className="flex gap-1">
                {s.keys.map((key) => (
                  <kbd
                    key={key}
                    className="px-2 py-0.5 text-xs font-mono bg-gray-100 border border-gray-200 rounded text-gray-700"
                  >
                    {key}
                  </kbd>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
