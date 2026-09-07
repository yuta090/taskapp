'use client'

import { useState, useRef, useEffect, useCallback, memo } from 'react'
import { createPortal } from 'react-dom'
import { Circle, CheckCircle, ArrowRight, ArrowCounterClockwise, DotsThree, CalendarBlank, Check } from '@phosphor-icons/react'
import { AmberDot, Tooltip, TruncatedText } from '@/components/shared'
import { getClientWaitingDays } from '@/lib/tasks/clientWaitingDays'
import type { Task, BallSide, TaskStatus, ReviewStatus } from '@/types/database'

/** Below this, "N日待ち" is not shown — a task that just passed to the client isn't stale yet. */
const CLIENT_WAITING_DAYS_THRESHOLD = 3
/** At/above this, the badge is emphasized in red (matches the row's overdue-date tone). */
const CLIENT_WAITING_DAYS_URGENT = 7

interface TaskRowProps {
  task: Task
  isSelected?: boolean
  onClick?: (taskId: string) => void
  indent?: boolean
  onStatusChange?: (taskId: string, status: TaskStatus) => void
  reviewStatus?: ReviewStatus
  assigneeName?: string | null
  isNew?: boolean
  bulkMode?: boolean
  isChecked?: boolean
  onCheckChange?: (taskId: string, checked: boolean) => void
  onContextMenu?: (taskId: string, x: number, y: number) => void
  /** Render the touch-friendly two-line mobile layout (<md). */
  isMobile?: boolean
  /** Injectable "current time" for the client-waiting-days badge (testing only). */
  now?: Date
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

// Row icons are deliberately one step lighter than the badge palette: at 18px
// next to every title, the 400/500 tints read as heavy noise down the list.
// Gray stays at 400: `.dark` remaps gray-300 to a border tone (#3A414E) that
// disappears against the dark row background.
function getStatusIcon(status: TaskStatus) {
  switch (status) {
    case 'done':
      return <CheckCircle weight="fill" className="text-green-400" />
    case 'in_progress':
      return <Circle weight="fill" className="text-blue-300" />
    case 'in_review':
      return <Circle weight="fill" className="text-amber-300" />
    case 'considering':
      return <Circle weight="duotone" className="text-gray-400" />
    case 'todo':
      return <Circle className="text-gray-400" />
    default:
      return <Circle className="text-gray-400" />
  }
}

/** Approximate rendered height of the status menu (5 items × 32px + padding). */
const STATUS_MENU_HEIGHT = 176
const STATUS_MENU_GAP = 4

/** Fixed-position anchor for the menu: below the icon, flipped above when it would leave the viewport. */
export function placeStatusMenu(
  rect: Pick<DOMRect, 'top' | 'bottom' | 'left'>,
  viewportHeight: number
): { top: number; left: number } {
  const below = rect.bottom + STATUS_MENU_GAP
  if (below + STATUS_MENU_HEIGHT <= viewportHeight) return { top: below, left: rect.left }
  return { top: Math.max(0, rect.top - STATUS_MENU_GAP - STATUS_MENU_HEIGHT), left: rect.left }
}

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'backlog', label: 'バックログ' },
  { value: 'todo', label: '着手予定' },
  { value: 'in_progress', label: '進行中' },
  { value: 'in_review', label: '社内承認中' },
  { value: 'done', label: '完了' },
]

function getStatusLabel(status: TaskStatus): string {
  const labels: Record<string, string> = {
    backlog: 'バックログ',
    todo: '着手予定',
    in_progress: '進行中',
    in_review: '社内承認中',
    considering: '検討中',
    done: '完了',
  }
  return labels[status] || status
}

interface StatusDropdownProps {
  status: TaskStatus
  onStatusChange?: (status: TaskStatus) => void
}

/**
 * Status picker for a row. The menu is rendered through a portal onto
 * document.body with `position: fixed`: the task list is virtualized and each
 * row sits in a `transform: translateY()` wrapper, which creates its own
 * stacking context. An `absolute` menu inside the row (even with z-50) is
 * painted underneath the rows that follow it, so their titles show through.
 */
function StatusDropdown({ status, onStatusChange }: StatusDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    // The list scrolls under the menu; close rather than let it drift away from its icon.
    const close = () => setIsOpen(false)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return
      setIsOpen(false)
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!onStatusChange) return
    if (isOpen) {
      setIsOpen(false)
      return
    }
    // Anchor from the click target's live rect (same approach as handleMobileActions).
    setMenuPos(placeStatusMenu(e.currentTarget.getBoundingClientRect(), window.innerHeight))
    setIsOpen(true)
  }

  const handleSelect = (newStatus: TaskStatus) => {
    onStatusChange?.(newStatus)
    setIsOpen(false)
  }

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={handleClick}
        className={`text-lg transition-transform ${onStatusChange ? 'hover:scale-110 cursor-pointer' : ''}`}
        aria-label={`ステータスを変更（現在: ${getStatusLabel(status)}）`}
        aria-haspopup={onStatusChange ? 'menu' : undefined}
        aria-expanded={onStatusChange ? isOpen : undefined}
      >
        {getStatusIcon(status)}
      </button>

      {isOpen && menuPos && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label="ステータスを選択"
          className="z-50 bg-surface rounded-lg shadow-popover border border-gray-200 py-1 min-w-[140px]"
          style={{ position: 'fixed', top: menuPos.top, left: menuPos.left }}
          onClick={(e) => e.stopPropagation()}
        >
          {STATUS_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitem"
              onClick={(e) => {
                e.stopPropagation()
                handleSelect(option.value)
              }}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-gray-900 hover:bg-gray-50 transition-colors ${
                status === option.value ? 'bg-gray-100' : ''
              }`}
            >
              <span className="text-base">{getStatusIcon(option.value)}</span>
              <span>{option.label}</span>
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  )
}

function BallIndicator({ ball, waitingDays }: { ball: BallSide; waitingDays?: number }) {
  if (ball !== 'client') return null
  return (
    <Tooltip content="次にアクションする側。外部=クライアントの対応待ち">
      <span className="flex items-center gap-1.5">
        <span className="flex items-center gap-1 text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
          <ArrowRight weight="bold" className="text-xs" />
          クライアント確認待ち
        </span>
        {waitingDays !== undefined && waitingDays >= CLIENT_WAITING_DAYS_THRESHOLD && (
          <span
            className={`text-[10px] ${
              waitingDays >= CLIENT_WAITING_DAYS_URGENT ? 'text-red-500 font-medium' : 'text-gray-500'
            }`}
          >
            {waitingDays}日待ち
          </span>
        )}
      </span>
    </Tooltip>
  )
}

export const TaskRow = memo(function TaskRow({ task, isSelected, onClick, indent = false, onStatusChange, reviewStatus: rawReviewStatus, assigneeName, isNew = false, bulkMode = false, isChecked = false, onCheckChange, onContextMenu, isMobile = false, now }: TaskRowProps) {
  // 取消済みレビューは「レビュー無し」と同じ扱い（バッジ非表示・再依頼クイックアクション表示）
  const reviewStatus = rawReviewStatus === 'cancelled' ? undefined : rawReviewStatus
  const formattedDueDate = formatDate(task.due_date)
  const overdue = task.status !== 'done' && isOverdue(task.due_date)
  const clientWaitingDays =
    task.ball === 'client' ? getClientWaitingDays(task.updated_at, now) : undefined

  const handleStatusChange = useCallback((newStatus: TaskStatus) => {
    onStatusChange?.(task.id, newStatus)
  }, [onStatusChange, task.id])

  const handleClick = useCallback(() => {
    onClick?.(task.id)
  }, [onClick, task.id])

  const handleMobileActions = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    onContextMenu?.(task.id, rect.left, rect.bottom)
  }, [onContextMenu, task.id])

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

  const selectionClass = isChecked
    ? 'bg-blue-50/60'
    : isSelected
      ? 'bg-blue-50 border-l-2 border-l-blue-500'
      : isNew
        ? 'bg-green-50/40 border-l-2 border-l-green-400'
        : 'active:bg-gray-50'

  // ── Mobile: touch-friendly 2-line row (title on top, meta below), fixed 64px ──
  if (isMobile) {
    return (
      <div
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        className={`task-row group flex items-center gap-2.5 cursor-pointer h-16 ${selectionClass}`}
        style={{ paddingLeft: indent ? 28 : 16, paddingRight: 14 }}
      >
        {/* Bulk selection checkbox (only in bulk mode on mobile) */}
        {onCheckChange && bulkMode && (
          <button
            type="button"
            onClick={handleCheck}
            className={`flex-shrink-0 w-5 h-5 rounded border flex items-center justify-center ${
              isChecked ? 'bg-blue-500 border-blue-500 text-white' : 'border-gray-300'
            }`}
            aria-label={isChecked ? '選択解除' : '選択'}
          >
            {isChecked && <Check weight="bold" className="w-3.5 h-3.5" />}
          </button>
        )}

        {/* Status icon (tap target) */}
        <div className="flex-shrink-0">
          <StatusDropdown
            status={task.status}
            onStatusChange={onStatusChange ? handleStatusChange : undefined}
          />
        </div>

        {/* Two-line content */}
        <div className="flex-1 min-w-0 flex flex-col justify-center gap-1 py-1.5">
          {/* Line 1: title + client-visible dot */}
          <div className="flex items-center gap-1.5 min-w-0">
            <TruncatedText className={`text-sm ${task.status === 'done' ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
              {task.title}
            </TruncatedText>
            {task.ball === 'client' && (
              <span className="flex-shrink-0"><AmberDot /></span>
            )}
          </div>

          {/* Line 2: meta — due date, ball status, badges, assignee (clips gracefully) */}
          <div className="flex items-center gap-2 min-w-0 overflow-hidden">
            {formattedDueDate && (
              <span className={`flex-shrink-0 flex items-center gap-0.5 text-[11px] ${overdue ? 'text-red-500' : 'text-gray-500'}`}>
                <CalendarBlank className="text-[12px]" />
                {formattedDueDate}
              </span>
            )}
            {task.ball === 'client' && task.status !== 'done' && (
              <span className="flex-shrink-0"><BallIndicator ball={task.ball} waitingDays={clientWaitingDays} /></span>
            )}
            {task.origin === 'client' && (
              <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium bg-purple-50 text-purple-700">
                {task.title.startsWith('[BUG]') ? 'バグ報告' : task.title.startsWith('[Q&A]') ? '質問' : 'クライアント'}
              </span>
            )}
            {reviewStatus && (
              <span className={`flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium ${
                reviewStatus === 'approved' ? 'bg-green-50 text-green-700'
                  : reviewStatus === 'changes_requested' ? 'bg-red-50 text-red-700'
                  : 'bg-amber-50 text-amber-700'
              }`}>
                {reviewStatus === 'approved' ? '社内承認済み' : reviewStatus === 'changes_requested' ? '差し戻し' : '社内承認待ち'}
              </span>
            )}
            {task.type === 'spec' && (
              <Tooltip content="仕様タスク: 決定が必要な仕様に紐づくタスク">
                <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-medium">SPEC</span>
              </Tooltip>
            )}
            {assigneeName && (
              <span
                className="flex-shrink-0 w-4 h-4 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center text-[9px] font-medium ml-auto"
                title={assigneeName}
              >
                {assigneeName.charAt(0)}
              </span>
            )}
          </div>
        </div>

        {/* Trailing kebab — always visible on mobile, opens action sheet */}
        <button
          type="button"
          data-testid="task-row-mobile-actions"
          onClick={handleMobileActions}
          className="flex-shrink-0 p-2 -mr-0.5 rounded text-gray-400 active:bg-gray-100"
          aria-label="タスクアクション"
        >
          <DotsThree weight="bold" className="text-lg" />
        </button>
      </div>
    )
  }

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
      {/* Bulk selection checkbox — 左に出る四角はこれ1つだけ。完了は右のホバー操作に置く */}
      {onCheckChange && (
        <button
          type="button"
          onClick={handleCheck}
          className={`flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-all ${
            bulkMode ? '' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
          } ${
            isChecked
              ? 'bg-blue-500 border-blue-500 text-white'
              : 'bg-surface border-gray-300 text-transparent hover:border-blue-400'
          }`}
          title="まとめて操作するタスクを選ぶ"
          aria-label={isChecked ? '選択解除' : '選択'}
        >
          <Check weight="bold" className="w-3 h-3" />
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
        {task.ball === 'client' && (
          <Tooltip content="ONでクライアントのポータルに表示されます">
            <span data-walkthrough="task-row-visibility">
              <AmberDot title="" />
            </span>
          </Tooltip>
        )}

        {/* Client origin badge */}
        {task.origin === 'client' && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
            task.title.startsWith('[BUG]')
              ? 'bg-red-50 text-red-700'
              : task.title.startsWith('[Q&A]')
              ? 'bg-blue-50 text-blue-700'
              : 'bg-purple-50 text-purple-700'
          }`}>
            {task.title.startsWith('[BUG]') ? 'バグ報告' :
             task.title.startsWith('[Q&A]') ? '質問' : 'クライアント'}
          </span>
        )}

        {/* Spec task badge */}
        {task.type === 'spec' && (
          <Tooltip content="仕様タスク: 決定が必要な仕様に紐づくタスク">
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-medium">
              SPEC
            </span>
          </Tooltip>
        )}

        {/* Sample task badge (preset-seeded, not client-visible → gray, not amber) */}
        {task.is_sample && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-medium">
            サンプル
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
              ? '社内承認済み'
              : reviewStatus === 'changes_requested'
              ? '差し戻し'
              : '社内承認待ち'}
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
          className="flex-shrink-0 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 bg-surface border border-gray-200 rounded hover:bg-gray-50 transition-colors"
        >
          社内承認を依頼
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
      {task.status !== 'done' && (
        <div className="flex-shrink-0 row-meta" data-walkthrough="task-row-ball">
          <BallIndicator ball={task.ball} waitingDays={clientWaitingDays} />
        </div>
      )}

      {/* Hover actions */}
      <div className="hidden row-actions items-center gap-1">
        {/* 完了の切り替え。四角ではなく文字つきボタンにして「選択」と見間違えないようにする */}
        {onStatusChange && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              handleStatusChange(task.status === 'done' ? 'todo' : 'done')
            }}
            className={`flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded border transition-colors ${
              task.status === 'done'
                ? 'text-gray-600 bg-surface border-gray-200 hover:bg-gray-50'
                : 'text-green-700 bg-surface border-green-200 hover:bg-green-50'
            }`}
            title={task.status === 'done' ? '未完了に戻す' : '完了にする'}
            aria-label={task.status === 'done' ? '未完了に戻す' : '完了にする'}
          >
            {task.status === 'done' ? (
              <ArrowCounterClockwise weight="bold" className="text-xs" />
            ) : (
              <CheckCircle weight="fill" className="text-xs" />
            )}
            {task.status === 'done' ? '戻す' : '完了'}
          </button>
        )}
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
