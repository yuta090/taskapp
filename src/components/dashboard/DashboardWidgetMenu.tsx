'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, SlidersHorizontal } from '@phosphor-icons/react'
import { DASHBOARD_WIDGETS, type DashboardWidgetPrefsApi } from '@/lib/dashboard/widgetPrefs'

/**
 * ダッシュボード右上の「表示する項目」。チェックを外した項目は画面から消える。
 * 開閉と外側クリック・Escape で閉じる作法は Wiki 一覧の表示項目メニュー（WikiListToolbar）と同じ。
 */
export function DashboardWidgetMenu({ isVisible, toggle }: DashboardWidgetPrefsApi) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpen(false)
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setOpen(false)
      // キーボードで操作している人が位置を見失わないよう、押したボタンに戻す
      buttonRef.current?.focus()
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  return (
    <div ref={menuRef} className="relative flex-shrink-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="dashboard-widgets-toggle"
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 hover:border-gray-300 bg-surface text-gray-600 transition-colors"
      >
        <SlidersHorizontal className="text-sm" />
        表示する項目
      </button>
      {open && (
        <div
          role="menu"
          aria-label="表示する項目"
          data-testid="dashboard-widgets-menu"
          className="absolute top-full right-0 mt-1 z-50 bg-surface rounded-lg shadow-lg border border-gray-200 min-w-[200px] py-1"
        >
          {DASHBOARD_WIDGETS.map((widget) => {
            const checked = isVisible(widget.id)
            return (
              <button
                key={widget.id}
                type="button"
                role="menuitemcheckbox"
                aria-checked={checked}
                onClick={() => toggle(widget.id)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <span
                  aria-hidden="true"
                  className={`w-4 h-4 rounded border flex items-center justify-center ${
                    checked ? 'bg-indigo-500 border-indigo-500 text-white' : 'border-gray-300'
                  }`}
                >
                  {checked && <Check weight="bold" className="text-xs" />}
                </span>
                <span className="whitespace-nowrap">{widget.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
