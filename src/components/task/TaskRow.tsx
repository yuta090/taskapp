'use client'

import { useState, useRef, useEffect, useCallback, memo } from 'react'
import { Circle, CheckCircle, ArrowRight, DotsThree, CalendarBlank, Check } from '@phosphor-icons/react'
import { AmberDot, TruncatedText } from '@/components/shared'
import type { Task, BallSide, TaskStatus } from '@/types/database'

interface TaskRowProps {
  task: Task
  isSelected?: boolean
  onClick?: (taskId: string) => void
  indent?: boolean
  onStatusChange?: (taskId: string, status: TaskStatus) => void
  reviewStatus?: 'open' | 'approved' | 'changes_requested'
  assigneeName?: string | null
  isNew?: boolean
  bulkMode?: boolean
  isChecked?: boolean
  onCheckChange?: (taskId: string, checked: boolean) => void
  onContextMenu?: (taskId: string, x: number, y: number) => void
}

function formatDate(dateStr: string | null): string | null {
  if (!dateStr) return null
  const date = new Date(dateStr)
  const month = date.getMonth() + 1
  const day = date.getDate()
  return `${month}/${day}`
}

function isOverdue(dateStr: string | null): boolean {
  if (!dateStr) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const dueDate = new Date(dateStr)
  dueDate.setHours(0, 0, 0, 0)
  return dueDate < today
}

const STATUS_OPTIONS: { value: TaskStatus; label: string; icon: React.ReactNode }[] = [
  { value: 'backlog', label: 'バックログ', icon: <Circle className="text-gray-400" /> },
  { value: 'todo', label: 'Todo', icon: <Circle className="text-gray-400" /> },
  { value: 'in_progress', label: '進行中', icon: <Circle weight="fill" className="text-blue-400" /> },
  { value: 'in_review', label: '承認確認中', icon: <Circle weight="fill" className="text-amber-400" /> },
  { value: 'done', label: '完了', icon: <CheckCircle weight="fill" className="text-green-500" /> },
]

function getStatusIcon(status: TaskStatus) {
  switch (status) {
    case 'done':
      return <CheckCircle weight="fill" className="text-green-500" />
    case 'in_progress':
      return <Circle weight="fill" className="text-blue-400" />
    case 'in_review':
      return <Circle weight="fill" className="text-amber-400" />
    case 'considering':
      return <Circle weight="duotone" className="text-gray-400" />
    case 'todo':
      return <Circle className="text-gray-400" />
    default:
      return <Circle className="text-gray-400" />
  }
}

function getStatusLabel(status: TaskStatus): string {
  const labels: Record<string, string> = {
    backlog: 'バックログ',
    todo: 'Todo',
    in_progress: '進行中',
    in_review: '承認確認中',
    considering: '検討中',
    done: '完了',
  }
  return labels[status] || status
}

interface StatusDropdownProps {
  status: TaskStatus
  onStatusChange?: (status: TaskStatus) => void
}

function StatusDropdown({ status, onStatusChange }: StatusDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (onStatusChange) {
      setIsOpen(!isOpen)
    }
  }

  const handleSelect = (newStatus: TaskStatus) => {
    onStatusChange?.(newStatus)
    setIsOpen(false)
  }

  return (
    <div ref={dropdownRef} className="relative">
      <button
        type="button"
        onClick={handleClick}
        className={`text-lg transition-transform ${onStatusChange ? 'hover:scale-110 cursor-pointer' : ''}`}
        aria-label={`ステータスを変更（現在: ${getStatusLabel(status)}）`}
      >
        {getStatusIcon(status)}
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full mt-1 z-50 bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-[140px]">
          {STATUS_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                handleSelect(option.value)
              }}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 transition-colors ${
                status === option.value ? 'bg-gray-100' : ''
              }`}
            >
              <span className="text-base">{option.icon}</span>
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function BallIndicator({ ball }: { ball: BallSide }) {
  if (ball === 'client') {
    return (
      <span className="flex items-center gap-1 text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
        <ArrowRight weight="bold" className="text-xs" />
        外部確認待ち
      </span>
    )
  }
  return null
}

export const TaskRow = memo(function TaskRow({ task, isSelected, onClick, indent = false, onStatusChange, reviewStatus, assigneeName, isNew = false, bulkMode = false, isChecked = false, onCheckChange, onContextMenu }: TaskRowProps) {
  const formattedDueDate = formatDate(task.due_date)
  const overdue = task.status !== 'done' && isOverdue(task.due_date)

  const handleStatusChange = useCallback((newStatus: TaskStatus) => {
    onStatusChange?.(task.id, newStatus)
  }, [onStatusChange, task.id])

  const handleClick = useCallback(() => {
    onClick?.(task.id)
  }, [onClick, task.id])

  const handleCheck = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onCheckChange?.(task.id, !isChecked)
  }, [onCheckChange, task.id, isChecked])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (onContextMenu) {
      e.preventDefault()
      onContextMenu(task.id, e.clientX, e.clientY)
    }
  }, [onContextMenu, task.id])

  return (
    <div
      onContextMenu={handleContextMenu}
      className={`task-row group row-h flex items-center gap-3 cursor-pointer transition-colors ${
        isChecked
          ? 'bg-blue-50/60'
          : isSelected
            ? 'bg-blue-50 border-l-2 border-l-blue-500'
            : isNew
              ? 'bg-green-50/40 border-l-2 border-l-green-400'
              : 'hover:bg-gray-50'
      }`}
      style={{ paddingLeft: indent ? 32 : 16, paddingRight: 16 }}
      onClick={handleClick}
    >
      {/* Bulk selection checkbox */}
      {onCheckChange && (
        <button
          type="button"
          onClick={handleCheck}
          className={`flex-shrink-0 w-3.5 h-3.5 rounded-sm border transition-all ${
            bulkMode ? '' : 'opacity-0 group-hover:opacity-100'
          } ${
            isChecked
              ? 'bg-blue-500 border-blue-500 text-white'
              : 'border-gray-300 hover:border-gray-400'
          }`}
          aria-label={isChecked ? '選択解除' : '選択'}
        >
          {isChecked && <Check weight="bold" className="w-full h-full" />}
        </button>
      )}

      {/* Quick done checkbox - Left side like Linear */}
      {onStatusChange && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            handleStatusChange(task.status === 'done' ? 'todo' : 'done')
          }}
          className={`flex-shrink-0 w-3.5 h-3.5 rounded-sm border transition-all ${
            task.status === 'done'
              ? 'bg-gray-900 border-gray-900 text-white'
              : 'border-gray-300 hover:border-gray-400 text-transparent hover:text-gray-400'
          }`}
          title={task.status === 'done' ? '未完了に戻す' : '完了にする'}
          aria-label={task.status === 'done' ? '未完了に戻す' : '完了にする'}
        >
          <Check weight="bold" className="w-full h-full" />
        </button>
      )}

      {/* Status icon with dropdown */}
      <div className="flex-shrink-0">
        <StatusDropdown
          status={task.status}
          onStatusChange={onStatusChange ? handleStatusChange : undefined}
        />
      </div>

      {/* Title + indicators */}
      <div className="flex-1 min-w-0 flex items-center gap-2">
        <TruncatedText className={task.status === 'done' ? 'text-gray-400 line-through' : ''}>
          {task.title}
        </TruncatedText>

        {/* Client visible indicator */}
        {task.ball === 'client' && <AmberDot />}

        {/* Spec task badge */}
        {task.type === 'spec' && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-medium">
            SPEC
          </span>
        )}

        {/* Decision state for spec tasks */}
        {task.type === 'spec' && task.decision_state && (
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
              task.decision_state === 'implemented'
                ? 'bg-green-50 text-green-700'
                : 'bg-gray-100 text-gray-500'
            }`}
          >
            {task.decision_state === 'implemented'
              ? '実装済'
              : task.decision_state === 'decided'
              ? '決定'
              : '検討中'}
          </span>
        )}

        {/* Review status badge */}
        {reviewStatus && (
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
              reviewStatus === 'approved'
                ? 'bg-green-50 text-green-700'
                : reviewStatus === 'changes_requested'
                ? 'bg-red-50 text-red-700'
                : 'bg-amber-50 text-amber-700'
            }`}
          >
            {reviewStatus === 'approved'
              ? '承認済'
              : reviewStatus === 'changes_requested'
              ? '差戻'
              : '承認待ち'}
          </span>
        )}
      </div>

      {/* Due date */}
      {formattedDueDate && (
        <div
          className={`flex-shrink-0 flex items-center gap-1 text-[11px] ${
            overdue ? 'text-red-500' : 'text-gray-500'
          }`}
        >
          <CalendarBlank className="text-[12px]" />
          <span>{formattedDueDate}</span>
        </div>
      )}

      {/* Quick review action for in_review tasks without review */}
      {task.status === 'in_review' && !reviewStatus && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onClick?.(task.id)
          }}
          className="flex-shrink-0 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 bg-white border border-gray-200 rounded hover:bg-gray-50 transition-colors"
        >
          承認を依頼
        </button>
      )}

      {/* Assignee avatar */}
      {assigneeName && (
        <div
          className="flex-shrink-0 w-5 h-5 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center text-[10px] font-medium"
          title={assigneeName}
        >
          {assigneeName.charAt(0)}
        </div>
      )}

      {/* Ball indicator */}
      <div className="flex-shrink-0 row-meta">
        <BallIndicator ball={task.ball} />
      </div>

      {/* Hover actions */}
      <div className="hidden row-actions items-center gap-1">
        <button
          data-testid="task-row-actions"
          className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600"
          aria-label="タスクアクション"
        >
          <DotsThree weight="bold" />
        </button>
      </div>
    </div>
  )
})
