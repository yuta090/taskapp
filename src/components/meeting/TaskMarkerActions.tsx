'use client'

import { useEffect, useRef, useState } from 'react'
import { CheckCircle, CircleNotch } from '@phosphor-icons/react'
import {
  buildMinutesTaskActions,
  taskStateLabel,
  type MinutesTaskAction,
  type MinutesTaskState,
} from '@/lib/minutes/taskActions'

interface TaskMarkerActionsProps {
  /** 開いた時点で読み込んだタスクの状態。null は読み込み中 */
  state: MinutesTaskState | null
  title: string | null
  /** 読み込みに失敗したときの文言 */
  error: string | null
  busy: boolean
  onAction: (action: MinutesTaskAction) => void
  onClose: () => void
}

/**
 * 議事録の「タスク作成済み」の印を押すと出る小さな操作パネル。
 *
 * 会議中に「これ終わったね」となったとき、議事録から離れずに終わらせられるようにする。
 * チェックを入れたら完了にする道も用意しているが、決定事項のタスクは先に「決定にする」が
 * 要るなど、チェックだけでは表せない操作がある。そこで印からも選べるようにする。
 *
 * 本文のカーソルを奪わないよう、パネルの mousedown は止める（エディタの中に出るため。
 * 止めないと押した時点で差し込み位置が消える）。
 */
export function TaskMarkerActions({
  state,
  title,
  error,
  busy,
  onAction,
  onClose,
}: TaskMarkerActionsProps) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [placeAbove, setPlaceAbove] = useState(false)

  // 画面の下のほうで開いたときに切れないよう、上下の空きを見て出す向きを決める。
  // effect で setState すると react-hooks/set-state-in-effect に当たるので ref のコールバックで測る
  const measure = (el: HTMLDivElement | null) => {
    panelRef.current = el
    if (!el) return
    const rect = el.getBoundingClientRect()
    const below = window.innerHeight - rect.top
    if (below < rect.height + 16) setPlaceAbove(true)
  }

  // Esc と、パネルの外を押したときに閉じる
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('mousedown', onDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('mousedown', onDown, true)
    }
  }, [onClose])

  const items = state ? buildMinutesTaskActions(state) : []

  return (
    <div
      ref={measure}
      contentEditable={false}
      data-testid="minutes-task-actions"
      role="dialog"
      aria-label="このタスクの操作"
      // 本文のカーソルを奪わない（ボタンの押下は onClick で受ける）
      onMouseDown={(e) => e.preventDefault()}
      className={
        'absolute z-20 w-64 rounded-lg border border-gray-200 bg-surface shadow-lg p-2 text-left ' +
        (placeAbove ? 'bottom-full mb-1' : 'top-full mt-1')
      }
    >
      {error ? (
        <p className="px-2 py-1.5 text-xs text-red-600">{error}</p>
      ) : state === null ? (
        <p className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-gray-400">
          <CircleNotch className="animate-spin" />
          読み込み中…
        </p>
      ) : (
        <>
          <div className="px-2 pb-1.5 border-b border-gray-100">
            <p className="text-xs font-medium text-gray-900 truncate" title={title ?? undefined}>
              {title ?? 'タスク'}
            </p>
            <p className="text-[10px] text-gray-500 mt-0.5">{taskStateLabel(state)}</p>
          </div>
          <div className="pt-1 space-y-0.5">
            {items.map((item) => (
              <button
                key={item.action}
                type="button"
                data-testid={`minutes-task-action-${item.action}`}
                disabled={item.disabledReason !== null || busy}
                title={item.disabledReason ?? undefined}
                onClick={() => onAction(item.action)}
                className={
                  'w-full text-left px-2 py-1.5 rounded text-xs transition-colors ' +
                  (item.disabledReason !== null || busy
                    ? 'text-gray-400 cursor-not-allowed'
                    : 'text-gray-700 hover:bg-gray-50')
                }
              >
                <span className="flex items-center gap-1.5">
                  {item.action === 'complete' && <CheckCircle className="text-sm" />}
                  {item.label}
                </span>
                {item.disabledReason && (
                  <span className="block text-[10px] text-gray-400 mt-0.5">
                    {item.disabledReason}
                  </span>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
