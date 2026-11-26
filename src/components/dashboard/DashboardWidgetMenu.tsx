'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Check, SlidersHorizontal } from '@phosphor-icons/react'
import {
  DASHBOARD_WIDGET_LABELS,
  type DashboardWidgetId,
  type DashboardWidgetPrefsApi,
} from '@/lib/dashboard/widgetPrefs'

/** メニューに出す行の順。「ボール（件数のまとめ）」は並び替えの対象外で、「件数のまとめ」の直後に付ける */
function menuRows(order: readonly DashboardWidgetId[]): DashboardWidgetId[] {
  return order.flatMap((id) => (id === 'kpi' ? [id, 'kpi_ball' as const] : [id]))
}

/**
 * ダッシュボード右上の「表示する項目」。チェックを外した項目は画面から消える。
 * 各行の「上へ」「下へ」で並び順を変える（画面上のドラッグでも変えられる）。
 * 開閉と外側クリック・Escape で閉じる作法は Wiki 一覧の表示項目メニュー（WikiListToolbar）と同じ。
 */
export function DashboardWidgetMenu({ isVisible, toggle, order, move, resetOrder }: DashboardWidgetPrefsApi) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  // 動かした行のボタンは、並びが変わると DOM ごと移って押した位置を見失う。キーボードで続けて押せるよう、動かしたあとに戻す
  const moveButtons = useRef(new Map<string, HTMLButtonElement>())
  const [lastMove, setLastMove] = useState<{ id: DashboardWidgetId; delta: -1 | 1 } | null>(null)

  useLayoutEffect(() => {
    if (!lastMove) return
    const { id, delta } = lastMove
    const same = moveButtons.current.get(`${id}:${delta}`)
    // 端まで動いて押せなくなったら、逆向きのボタンへ
    const target = same && !same.disabled ? same : moveButtons.current.get(`${id}:${-delta}`)
    target?.focus()
  }, [lastMove, order])

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
          {menuRows(order).map((id) => {
            const checked = isVisible(id)
            const label = DASHBOARD_WIDGET_LABELS[id]
            const sub = id === 'kpi_ball'
            const index = order.indexOf(id)
            return (
              <div key={id} className="flex items-center hover:bg-gray-50 transition-colors">
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={checked}
                  onClick={() => toggle(id)}
                  className={`flex-1 min-w-0 flex items-center gap-2 py-1.5 text-sm text-gray-700 ${
                    sub ? 'pl-8 pr-3' : 'px-3'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`w-4 h-4 flex-shrink-0 rounded border flex items-center justify-center ${
                      checked ? 'bg-indigo-500 border-indigo-500 text-white' : 'border-gray-300'
                    }`}
                  >
                    {checked && <Check weight="bold" className="text-xs" />}
                  </span>
                  <span className="whitespace-nowrap">{label}</span>
                </button>
                {!sub && (
                  <span className="flex items-center pr-2 flex-shrink-0">
                    {([-1, 1] as const).map((delta) => {
                      const Icon = delta === -1 ? ArrowUp : ArrowDown
                      const atEdge = delta === -1 ? index === 0 : index === order.length - 1
                      return (
                        <button
                          key={delta}
                          ref={(el) => {
                            if (el) moveButtons.current.set(`${id}:${delta}`, el)
                            else moveButtons.current.delete(`${id}:${delta}`)
                          }}
                          type="button"
                          role="menuitem"
                          aria-label={`${label}を${delta === -1 ? '上' : '下'}へ`}
                          disabled={atEdge}
                          onClick={() => {
                            move(id, delta)
                            setLastMove({ id, delta })
                          }}
                          className="p-1 rounded text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent"
                        >
                          <Icon className="text-sm" />
                        </button>
                      )
                    })}
                  </span>
                )}
              </div>
            )
          })}
          <div className="border-t border-gray-100 mt-1 pt-1">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setLastMove(null)
                resetOrder()
              }}
              className="w-full px-3 py-1.5 text-left text-sm text-gray-600 hover:bg-gray-50 transition-colors"
            >
              並び順を元に戻す
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
