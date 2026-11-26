'use client'

import { useRef, type DragEvent, type ReactNode } from 'react'
import { DotsSixVertical } from '@phosphor-icons/react'
import type { DashboardWidgetId } from '@/lib/dashboard/widgetPrefs'

/**
 * ダッシュボードの各項目を包む枠。デスクトップ（md 以上）だけ、右上に出るつかみをドラッグして
 * 別の項目の上に落とすと、落とした先の項目の前に移る（HTML5 の drag and drop）。
 * スマホ（md 未満）ではつかみを出さない。キーボードや指での並び替えは「表示する項目」メニューの上へ・下へ。
 *
 * ドラッグの状態（どれを持っているか・どこの上か）は親が持つ。この枠は DOM のイベントを親の言葉に直すだけ。
 */
export function DashboardWidgetFrame({
  id,
  label,
  draggingId,
  overId,
  onDragStart,
  onDragEnd,
  onDragOverWidget,
  onDragLeaveWidget,
  onDropOnWidget,
  children,
}: {
  id: DashboardWidgetId
  label: string
  draggingId: DashboardWidgetId | null
  overId: DashboardWidgetId | null
  onDragStart: (id: DashboardWidgetId) => void
  onDragEnd: () => void
  onDragOverWidget: (id: DashboardWidgetId) => void
  onDragLeaveWidget: (id: DashboardWidgetId) => void
  onDropOnWidget: (id: DashboardWidgetId) => void
  children: ReactNode
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const dragging = draggingId === id
  const dropTarget = draggingId !== null && draggingId !== id && overId === id

  function handleDragStart(event: DragEvent<HTMLSpanElement>) {
    const transfer = event.dataTransfer
    if (transfer) {
      transfer.effectAllowed = 'move'
      // Firefox は setData が無いとドラッグが始まらない
      transfer.setData('text/plain', id)
      // つかみだけでなく、項目全体を持っているように見せる
      if (rootRef.current && typeof transfer.setDragImage === 'function') transfer.setDragImage(rootRef.current, 16, 16)
    }
    onDragStart(id)
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    if (draggingId === null || draggingId === id) return
    // preventDefault しないと、ブラウザはこの上に落とすことを許さない
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    onDragOverWidget(id)
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    // 枠の中の子要素に入っただけのときは、離れたことにしない
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    onDragLeaveWidget(id)
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    if (draggingId === null || draggingId === id) return
    event.preventDefault()
    onDropOnWidget(id)
  }

  return (
    <div
      ref={rootRef}
      data-testid={`dashboard-widget-${id}`}
      data-dragging={dragging ? 'true' : undefined}
      data-drop-target={dropTarget ? 'true' : undefined}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`group relative min-w-0 rounded-lg transition-shadow ${dragging ? 'opacity-50' : ''} ${
        dropTarget ? 'ring-2 ring-indigo-500' : ''
      }`}
    >
      <span
        draggable
        aria-hidden="true"
        title={`${label}をドラッグして並び替え`}
        data-testid={`dashboard-widget-handle-${id}`}
        onDragStart={handleDragStart}
        onDragEnd={onDragEnd}
        className="hidden md:flex absolute top-1 right-1 z-10 w-5 h-5 items-center justify-center rounded text-gray-300 hover:text-gray-500 hover:bg-gray-100 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <DotsSixVertical weight="bold" className="text-sm" />
      </span>
      {children}
    </div>
  )
}
