'use client'

import { memo } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { DotsSixVertical, LinkBreak } from '@phosphor-icons/react'
import { GANTT_CONFIG } from '@/lib/gantt/constants'
import type { Task } from '@/types/database'

interface TaskRowProps {
  task: Task
  isSelected: boolean
  statusColors: { bg: string; text: string }
  statusLabel: string
  onClick: () => void
  groupByMilestone: boolean
  hasParent: boolean
}

interface DraggableTaskRowProps extends TaskRowProps {
  isDraggable: boolean
  isDropTarget: boolean
  isOverThis: boolean
  isBeingDragged: boolean
  onRemoveParent?: () => void
}

interface DroppableTaskRowProps extends TaskRowProps {
  isDropTarget: boolean
  isOverThis: boolean
}

/** Row that can be both dragged (to become a child) and dropped on (to become a parent) */
export const DraggableTaskRow = memo(function DraggableTaskRow({
  task,
  isSelected,
  statusColors,
  statusLabel,
  onClick,
  isDraggable,
  isDropTarget,
  isOverThis,
  isBeingDragged,
  groupByMilestone,
  hasParent,
  onRemoveParent,
}: DraggableTaskRowProps) {
  const {
    attributes: dragAttributes,
    listeners: dragListeners,
    setNodeRef: setDragRef,
  } = useDraggable({
    id: task.id,
    disabled: !isDraggable,
  })

  const {
    setNodeRef: setDropRef,
    isOver,
  } = useDroppable({
    id: task.id,
    disabled: !isDropTarget,
  })

  const isActiveOver = isOverThis || (isOver && isDropTarget)

  return (
    <div
      ref={(node) => {
        setDragRef(node)
        setDropRef(node)
      }}
      onClick={onClick}
      className="flex items-center gap-1 cursor-pointer transition-colors group"
      style={{
        height: GANTT_CONFIG.ROW_HEIGHT,
        backgroundColor: isActiveOver
          ? '#EEF2FF'  // Indigo-50 for drop target highlight
          : isBeingDragged
          ? '#F1F5F9'
          : isSelected
          ? '#F1F5F9'
          : undefined,
        borderBottom: `0.5px solid ${GANTT_CONFIG.COLORS.GRID_LINE}`,
        borderLeft: isActiveOver ? '3px solid #6366F1' : '3px solid transparent',
        paddingLeft: hasParent
          ? (groupByMilestone ? 28 : 16)
          : (groupByMilestone ? 8 : 4),
        paddingRight: 12,
        opacity: isBeingDragged ? 0.4 : 1,
      }}
    >
      {/* Drag handle - always visible with subtle style, prominent on hover */}
      {isDraggable && (
        <button
          {...dragAttributes}
          {...dragListeners}
          className="flex-shrink-0 p-1 rounded opacity-30 group-hover:opacity-100 hover:!bg-indigo-50 cursor-grab active:cursor-grabbing transition-all"
          onClick={(e) => e.stopPropagation()}
          title="ドラッグして親タスクに紐づけ"
          aria-label="ドラッグして親タスクに紐づけ"
        >
          <DotsSixVertical className="w-4 h-4 text-gray-500 group-hover:text-indigo-500" weight="bold" />
        </button>
      )}

      {/* Ball indicator */}
      <div
        className="w-2 h-2 rounded-full flex-shrink-0"
        style={{
          backgroundColor:
            task.ball === 'client'
              ? GANTT_CONFIG.COLORS.CLIENT
              : GANTT_CONFIG.COLORS.INTERNAL,
        }}
        title={task.ball === 'client' ? '外部' : '社内'}
      />

      {/* Indented child indicator */}
      {hasParent && (
        <span className="text-gray-300 text-[10px] flex-shrink-0">└</span>
      )}

      {/* Task title */}
      <span
        className="flex-1 truncate text-gray-900"
        style={{
          fontSize: GANTT_CONFIG.FONT.SIZE_SM,
          fontWeight: isSelected ? 500 : 400,
        }}
      >
        {task.title}
      </span>

      {/* Remove parent button (for child tasks) */}
      {onRemoveParent && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onRemoveParent()
          }}
          className="flex-shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
          title="親タスクの紐づけを解除"
          aria-label="親タスクの紐づけを解除"
        >
          <LinkBreak className="w-3 h-3 text-gray-400" />
        </button>
      )}

      {/* Status badge */}
      <span
        className="px-1.5 py-0.5 rounded text-[10px] font-medium flex-shrink-0"
        style={{
          backgroundColor: statusColors.bg,
          color: statusColors.text,
        }}
      >
        {statusLabel}
      </span>

      {/* Drop target hint */}
      {isActiveOver && (
        <span className="text-[10px] text-indigo-500 font-medium flex-shrink-0 whitespace-nowrap">
          子にする
        </span>
      )}
    </div>
  )
})

/** Row that can only be dropped on (parent tasks during drag) */
export const DroppableTaskRow = memo(function DroppableTaskRow({
  task,
  isSelected,
  statusColors,
  statusLabel,
  onClick,
  isDropTarget,
  isOverThis,
  groupByMilestone,
  hasParent,
}: DroppableTaskRowProps) {
  const {
    setNodeRef,
    isOver,
  } = useDroppable({
    id: task.id,
    disabled: !isDropTarget,
  })

  const isActiveOver = isOverThis || (isOver && isDropTarget)

  return (
    <div
      ref={setNodeRef}
      onClick={onClick}
      className="flex items-center gap-2 cursor-pointer transition-colors hover:bg-gray-50"
      style={{
        height: GANTT_CONFIG.ROW_HEIGHT,
        backgroundColor: isActiveOver
          ? '#EEF2FF'
          : isSelected
          ? '#F1F5F9'
          : undefined,
        borderBottom: `0.5px solid ${GANTT_CONFIG.COLORS.GRID_LINE}`,
        borderLeft: isActiveOver ? '3px solid #6366F1' : '3px solid transparent',
        paddingLeft: hasParent
          ? (groupByMilestone ? 28 : 16)
          : (groupByMilestone ? 21 : 9),
        paddingRight: 12,
      }}
    >
      {/* Ball indicator */}
      <div
        className="w-2 h-2 rounded-full flex-shrink-0"
        style={{
          backgroundColor:
            task.ball === 'client'
              ? GANTT_CONFIG.COLORS.CLIENT
              : GANTT_CONFIG.COLORS.INTERNAL,
        }}
        title={task.ball === 'client' ? '外部' : '社内'}
      />

      {/* Indented child indicator */}
      {hasParent && (
        <span className="text-gray-300 text-[10px] flex-shrink-0">└</span>
      )}

      {/* Task title */}
      <span
        className="flex-1 truncate text-gray-900"
        style={{
          fontSize: GANTT_CONFIG.FONT.SIZE_SM,
          fontWeight: isSelected ? 500 : 400,
        }}
      >
        {task.title}
      </span>

      {/* Status badge */}
      <span
        className="px-1.5 py-0.5 rounded text-[10px] font-medium flex-shrink-0"
        style={{
          backgroundColor: statusColors.bg,
          color: statusColors.text,
        }}
      >
        {statusLabel}
      </span>

      {/* Drop target hint */}
      {isActiveOver && (
        <span className="text-[10px] text-indigo-500 font-medium flex-shrink-0 whitespace-nowrap">
          子にする
        </span>
      )}
    </div>
  )
})
