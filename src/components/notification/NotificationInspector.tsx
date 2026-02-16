'use client'

import { useCallback, useEffect, useState, useRef } from 'react'
import Link from 'next/link'
import {
  X,
  CheckCircle,
  XCircle,
  Bell,
  ChatCircleText,
  Calendar,
  Warning,
  ArrowRight,
  Eye,
  CaretUp,
  CaretDown,
  ArrowSquareOut,
  Circle,
  Spinner,
  Play,
} from '@phosphor-icons/react'
import { createClient } from '@/lib/supabase/client'
import { rpc } from '@/lib/supabase/rpc'
import { isActionableNotification } from '@/lib/notifications/classify'
import type { NotificationWithPayload } from '@/lib/hooks/useNotifications'
import type { Task, TaskStatus } from '@/types/database'
import type { SupabaseClient } from '@supabase/supabase-js'

interface NotificationInspectorProps {
  notification: NotificationWithPayload
  onClose: () => void
  onMarkAsRead: (id: string) => void
  onMarkAsActioned?: (id: string) => void
  onNavigate: (direction: 'prev' | 'next') => void
  hasPrev: boolean
  hasNext: boolean
}

const STATUS_OPTIONS: { value: TaskStatus; label: string; color: string }[] = [
  { value: 'backlog', label: 'バックログ', color: 'text-gray-300' },
  { value: 'todo', label: 'Todo', color: 'text-gray-400' },
  { value: 'in_progress', label: '進行中', color: 'text-blue-400' },
  { value: 'in_review', label: '承認確認中', color: 'text-amber-400' },
  { value: 'done', label: '完了', color: 'text-green-500' },
]

function getStatusLabel(status: TaskStatus): string {
  return STATUS_OPTIONS.find(s => s.value === status)?.label || status
}

function getStatusColor(status: TaskStatus): string {
  return STATUS_OPTIONS.find(s => s.value === status)?.color || 'text-gray-500'
}

function getNotificationIcon(type: string, urgent?: boolean) {
  const iconClass = "text-2xl"

  if (urgent) {
    return <Warning className={`${iconClass} text-red-500`} weight="fill" />
  }

  switch (type) {
    case 'review_request':
      return <Eye className={`${iconClass} text-blue-500`} />
    case 'client_question':
    case 'client_feedback':
      return <ChatCircleText className={`${iconClass} text-amber-500`} />
    case 'task_assigned':
    case 'ball_passed':
      return <ArrowRight className={`${iconClass} text-indigo-500`} />
    case 'due_date_reminder':
      return <Warning className={`${iconClass} text-orange-500`} />
    case 'meeting_reminder':
    case 'meeting_scheduled':
      return <Calendar className={`${iconClass} text-green-500`} />
    case 'meeting_ended':
      return <CheckCircle className={`${iconClass} text-blue-500`} weight="fill" />
    case 'task_completed':
      return <CheckCircle className={`${iconClass} text-green-500`} weight="fill" />
    case 'confirmation_request':
    case 'urgent_confirmation':
      return <ChatCircleText className={`${iconClass} text-amber-500`} />
    case 'spec_decision_needed':
      return <Bell className={`${iconClass} text-amber-500`} />
    default:
      return <Bell className={`${iconClass} text-gray-500`} />
  }
}

function getNotificationTypeLabel(type: string): string {
  switch (type) {
    case 'review_request': return '承認依頼'
    case 'client_question': return '外部からの質問'
    case 'client_feedback': return '外部からのフィードバック'
    case 'task_assigned': return 'タスク割り当て'
    case 'ball_passed': return 'ボール移動'
    case 'due_date_reminder': return '期限リマインダー'
    case 'meeting_reminder': return 'ミーティングリマインダー'
    case 'meeting_scheduled': return 'ミーティング予定'
    case 'meeting_ended': return '会議終了'
    case 'task_completed': return 'タスク完了'
    case 'confirmation_request': return '確認依頼'
    case 'urgent_confirmation': return '緊急確認依頼'
    case 'spec_decision_needed': return '仕様決定依頼'
    default: return '通知'
  }
}

function formatDateTime(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleString('ja-JP', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function NotificationInspector({
  notification,
  onClose,
  onMarkAsRead,
  onMarkAsActioned,
  onNavigate,
  hasPrev,
  hasNext,
}: NotificationInspectorProps) {
  const payload = notification.payload
  const isUnread = notification.read_at === null
  const isUrgent = payload.urgent === true
  const taskId = payload.task_id
  const isActionable = isActionableNotification(notification.type)

  // Task state
  const [task, setTask] = useState<Task | null>(null)
  const [taskLoading, setTaskLoading] = useState(false)
  const [statusUpdating, setStatusUpdating] = useState(false)
  const [showStatusMenu, setShowStatusMenu] = useState(false)
  // Whether the current user has a review_approval record for this task
  const [hasReviewRecord, setHasReviewRecord] = useState(false)

  // Action panel state
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [blockReason, setBlockReason] = useState('')
  const [showBlockForm, setShowBlockForm] = useState(false)
  const [actionCompleted, setActionCompleted] = useState<string | null>(null)

  // Supabase client (lazy useRef pattern)
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  // Track current notification ID in ref for stale-timer guard
  const notificationIdRef = useRef(notification.id)
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    notificationIdRef.current = notification.id
  }, [notification.id])

  // Reset action state + clear pending timers when notification changes
  useEffect(() => {
    setBlockReason('')
    setShowBlockForm(false)
    setActionCompleted(null)
    setActionLoading(false)
    setActionError(null)
    if (advanceTimerRef.current) {
      clearTimeout(advanceTimerRef.current)
      advanceTimerRef.current = null
    }
  }, [notification.id])

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (advanceTimerRef.current) {
        clearTimeout(advanceTimerRef.current)
      }
    }
  }, [])

  // Schedule auto-advance after action, guarded by ref
  // Uses onMarkAsActioned (sets actioned_at + read_at) instead of plain onMarkAsRead
  const scheduleAdvance = useCallback(() => {
    const scheduledId = notification.id
    advanceTimerRef.current = setTimeout(() => {
      advanceTimerRef.current = null
      if (notificationIdRef.current !== scheduledId) return
      // Mark as actioned (which also sets read_at), fallback to markAsRead
      if (onMarkAsActioned) {
        onMarkAsActioned(scheduledId)
      } else if (isUnread) {
        onMarkAsRead(scheduledId)
      }
      if (hasNext) onNavigate('next')
    }, 600)
  }, [notification.id, isUnread, onMarkAsRead, onMarkAsActioned, hasNext, onNavigate])

  // Fetch task if notification has task_id (with race condition guard)
  // Also check review_approvals for review_request notifications
  useEffect(() => {
    if (!taskId) {
      setTask(null)
      setHasReviewRecord(false)
      return
    }

    let cancelled = false

    const fetchTask = async () => {
      setTaskLoading(true)
      setHasReviewRecord(false)
      try {
        const { data, error } = await (supabase as SupabaseClient)
          .from('tasks')
          .select('*')
          .eq('id', taskId)
          .single()

        if (error) throw error
        if (!cancelled) {
          setTask(data)
        }

        // For review_request: check if current user has a review_approval record
        if (notification.type === 'review_request' && !cancelled) {
          const { data: userData } = await supabase.auth.getUser()
          if (userData?.user && !cancelled) {
            const { data: approvalData } = await (supabase as SupabaseClient)
              .from('review_approvals')
              .select('id, review_id!inner(task_id)')
              .eq('review_id.task_id', taskId)
              .eq('reviewer_id', userData.user.id)
              .limit(1)

            if (!cancelled) {
              setHasReviewRecord(Array.isArray(approvalData) && approvalData.length > 0)
            }
          }
        }
      } catch (err) {
        console.error('Failed to fetch task:', err)
        if (!cancelled) {
          setTask(null)
        }
      } finally {
        if (!cancelled) {
          setTaskLoading(false)
        }
      }
    }

    fetchTask()

    return () => {
      cancelled = true
    }
  }, [taskId, supabase, notification.type])

  // Update task status - returns true on success, false on failure
  const handleStatusChange = useCallback(async (newStatus: TaskStatus): Promise<boolean> => {
    if (!task) return false

    const prevStatus = task.status
    setStatusUpdating(true)
    setShowStatusMenu(false)

    // Optimistic update
    setTask(prev => prev ? { ...prev, status: newStatus } : null)

    try {
      const { data: updated, error } = await (supabase as SupabaseClient)
        .from('tasks')
        .update({ status: newStatus })
        .eq('id', task.id)
        .select('id')

      if (error) throw error
      if (!updated || updated.length === 0) {
        throw new Error('タスクが見つかりませんでした')
      }
      return true
    } catch (err) {
      console.error('Failed to update task status:', err)
      // Rollback optimistic update
      setTask(prev => prev ? { ...prev, status: prevStatus } : null)
      return false
    } finally {
      setStatusUpdating(false)
    }
  }, [task, supabase])

  // Quick complete task - only proceed if status update succeeds
  const handleQuickComplete = useCallback(async () => {
    if (!task) return

    const success = await handleStatusChange('done')
    if (!success) return

    if (isUnread) {
      onMarkAsRead(notification.id)
    }
    if (hasNext) {
      onNavigate('next')
    }
  }, [task, handleStatusChange, isUnread, onMarkAsRead, notification.id, hasNext, onNavigate])

  const handleMarkAsReadAndNext = useCallback(() => {
    if (isUnread) {
      onMarkAsRead(notification.id)
    }
    if (hasNext) {
      onNavigate('next')
    }
  }, [isUnread, notification.id, onMarkAsRead, hasNext, onNavigate])

  // --- Action handlers for specific notification types ---

  // Extract user-facing message from RPC error
  const getRpcErrorMessage = (err: unknown, fallback: string): string => {
    if (err instanceof Error && err.message) {
      // Map known RPC error messages to Japanese
      if (err.message.includes('No review found')) return 'レビューレコードが見つかりません。'
      if (err.message.includes('not a reviewer')) return 'このタスクのレビュー権限がありません。'
      if (err.message.includes('Task not found')) return 'タスクが見つかりません。'
      if (err.message.includes('Authentication required')) return '認証が必要です。ページをリロードしてください。'
      if (err.message.includes('Only spec tasks')) return '仕様タスクでないため操作できません。'
      return fallback
    }
    return fallback
  }

  // Review: Approve
  const handleReviewApprove = useCallback(async () => {
    if (!taskId) return
    setActionLoading(true)
    setActionError(null)
    try {
      await rpc.reviewApprove(supabase, { taskId })
      setActionCompleted('approved')
      scheduleAdvance()
    } catch (err: unknown) {
      console.error('Review approve failed:', err)
      setActionError(getRpcErrorMessage(err, '承認に失敗しました。再試行してください。'))
    } finally {
      setActionLoading(false)
    }
  }, [taskId, supabase, scheduleAdvance])

  // Review: Block (with reason)
  const handleReviewBlock = useCallback(async () => {
    if (!taskId || !blockReason.trim()) return
    setActionLoading(true)
    setActionError(null)
    try {
      await rpc.reviewBlock(supabase, { taskId, blockedReason: blockReason.trim() })
      setActionCompleted('blocked')
      scheduleAdvance()
    } catch (err: unknown) {
      console.error('Review block failed:', err)
      setActionError(getRpcErrorMessage(err, '差し戻しに失敗しました。再試行してください。'))
    } finally {
      setActionLoading(false)
    }
  }, [taskId, blockReason, supabase, scheduleAdvance])

  // Ball passed / Task assigned: Start working
  const handleStartWork = useCallback(async () => {
    if (!task) return
    setActionError(null)
    const success = await handleStatusChange('in_progress')
    if (success) {
      setActionCompleted('started')
      scheduleAdvance()
    } else {
      setActionError('ステータス更新に失敗しました。')
    }
  }, [task, handleStatusChange, scheduleAdvance])

  // Spec decision: Mark as decided
  const handleSpecDecision = useCallback(async () => {
    if (!taskId) return
    setActionLoading(true)
    setActionError(null)
    try {
      await rpc.setSpecState(supabase, { taskId, decisionState: 'decided' })
      setActionCompleted('decided')
      scheduleAdvance()
    } catch (err: unknown) {
      console.error('Spec decision failed:', err)
      setActionError(getRpcErrorMessage(err, '仕様決定の更新に失敗しました。再試行してください。'))
    } finally {
      setActionLoading(false)
    }
  }, [taskId, supabase, scheduleAdvance])

  // --- Render action panel based on notification type ---
  const renderActionError = () => actionError ? (
    <p className="text-xs text-red-600 mt-2">{actionError}</p>
  ) : null

  const renderActionPanel = () => {
    // All action panels use unified container: bg-gray-50 + border-gray-200
    // Color is reserved for CTA buttons only (green=approve, red=reject, blue=primary action)

    // Review request: Approve / Block (only if review record exists for current user)
    if (notification.type === 'review_request' && taskId && hasReviewRecord) {
      return (
        <div className="mb-4 bg-gray-50 rounded-lg p-3 border border-gray-200">
          <p className="text-xs text-gray-500 mb-2 font-medium">承認アクション</p>
          {actionCompleted ? (
            <div className="flex items-center gap-2 text-sm text-green-600">
              <CheckCircle weight="fill" />
              <span>{actionCompleted === 'approved' ? '承認しました' : '差し戻しました'}</span>
            </div>
          ) : !showBlockForm ? (
            <div className="space-y-2">
              <button
                type="button"
                onClick={handleReviewApprove}
                disabled={actionLoading}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                {actionLoading ? (
                  <Spinner className="animate-spin" />
                ) : (
                  <CheckCircle weight="bold" />
                )}
                承認する
              </button>
              <button
                type="button"
                onClick={() => setShowBlockForm(true)}
                disabled={actionLoading}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium border border-gray-300 text-red-600 rounded-md hover:bg-red-50 disabled:opacity-50 transition-colors"
              >
                <XCircle weight="bold" />
                差し戻す
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <textarea
                value={blockReason}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setBlockReason(e.target.value)}
                placeholder="差し戻し理由を入力..."
                rows={3}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowBlockForm(false)}
                  className="flex-1 px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={handleReviewBlock}
                  disabled={actionLoading || !blockReason.trim()}
                  className="flex-1 px-3 py-2 text-sm bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 transition-colors"
                >
                  {actionLoading ? (
                    <Spinner className="animate-spin mx-auto" />
                  ) : (
                    '差し戻す'
                  )}
                </button>
              </div>
            </div>
          )}
          {renderActionError()}
        </div>
      )
    }

    // Review request: no review record found - show fallback
    if (notification.type === 'review_request' && taskId && !hasReviewRecord && !taskLoading) {
      return (
        <div className="mb-4 bg-gray-50 rounded-lg p-3 border border-gray-200">
          <p className="text-xs text-gray-500">レビューレコードが見つかりません。「詳細を見る」からタスクを確認してください。</p>
        </div>
      )
    }

    // Confirmation / Urgent confirmation: Link to scheduling page
    if ((notification.type === 'confirmation_request' || notification.type === 'urgent_confirmation') && payload.link) {
      return (
        <div className="mb-4 bg-gray-50 rounded-lg p-3 border border-gray-200">
          <p className="text-xs text-gray-500 mb-2 font-medium">日程調整への回答が必要です</p>
          <Link
            href={payload.link}
            className="flex items-center justify-center gap-2 w-full px-4 py-2 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-md transition-colors"
          >
            <Calendar />
            日程を回答する
          </Link>
        </div>
      )
    }

    // Ball passed / Task assigned: Start work button
    if ((notification.type === 'ball_passed' || notification.type === 'task_assigned') && task) {
      if (actionCompleted) {
        return (
          <div className="mb-4 bg-gray-50 rounded-lg p-3 border border-gray-200">
            <div className="flex items-center gap-2 text-sm text-green-600">
              <CheckCircle weight="fill" />
              <span>対応を開始しました</span>
            </div>
          </div>
        )
      }
      if (task.status !== 'in_progress' && task.status !== 'done') {
        return (
          <div className="mb-4 bg-gray-50 rounded-lg p-3 border border-gray-200">
            <p className="text-xs text-gray-500 mb-2 font-medium">タスク対応</p>
            <button
              type="button"
              onClick={handleStartWork}
              disabled={statusUpdating}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50 transition-colors"
            >
              {statusUpdating ? (
                <Spinner className="animate-spin" />
              ) : (
                <Play weight="fill" />
              )}
              対応開始して次へ
            </button>
            {renderActionError()}
          </div>
        )
      }
    }

    // Spec decision needed: Mark as decided (only for spec tasks that aren't already decided)
    if (notification.type === 'spec_decision_needed' && taskId && task?.type === 'spec' && task?.decision_state === 'considering') {
      return (
        <div className="mb-4 bg-gray-50 rounded-lg p-3 border border-gray-200">
          <p className="text-xs text-gray-500 mb-2 font-medium">仕様決定アクション</p>
          {actionCompleted ? (
            <div className="flex items-center gap-2 text-sm text-green-600">
              <CheckCircle weight="fill" />
              <span>決定済みに更新しました</span>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleSpecDecision}
              disabled={actionLoading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50 transition-colors"
            >
              {actionLoading ? (
                <Spinner className="animate-spin" />
              ) : (
                <CheckCircle weight="bold" />
              )}
              決定済みにする
            </button>
          )}
          {renderActionError()}
        </div>
      )
    }

    return null
  }

  // Whether to hide the generic "Complete and Next" footer button
  // (actionable types have their own primary actions)
  const hasTypeSpecificAction = isActionable && !actionCompleted

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="flex-shrink-0 h-12 border-b border-gray-100 flex items-center px-4 gap-2">
        <div className="flex-1 flex items-center gap-2 min-w-0">
          <span className="text-xs text-gray-500 truncate">
            {getNotificationTypeLabel(notification.type)}
          </span>
          {isUrgent && (
            <span className="text-[10px] px-1.5 py-0.5 bg-red-50 text-red-600 rounded font-medium">
              緊急
            </span>
          )}
        </div>

        {/* Navigation */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onNavigate('prev')}
            disabled={!hasPrev}
            className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
            title="前の通知"
          >
            <CaretUp className="text-gray-500" />
          </button>
          <button
            type="button"
            onClick={() => onNavigate('next')}
            disabled={!hasNext}
            className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
            title="次の通知"
          >
            <CaretDown className="text-gray-500" />
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded hover:bg-gray-100"
          title="閉じる"
        >
          <X className="text-gray-500" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* Icon + Title */}
        <div className="flex items-start gap-3 mb-4">
          <div className="flex-shrink-0 mt-0.5">
            {getNotificationIcon(notification.type, isUrgent)}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-medium text-gray-900">
              {payload.title || '通知'}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {formatDateTime(notification.created_at)}
              {payload.from_user_name && ` · ${payload.from_user_name}`}
            </p>
          </div>
        </div>

        {/* Message */}
        <div className="mb-4">
          <p className="text-sm text-gray-700 whitespace-pre-wrap">
            {payload.message}
          </p>
        </div>

        {/* Comment if exists */}
        {payload.comment && (
          <div className="mb-4 bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-500 mb-1">コメント</p>
            <p className="text-sm text-gray-700">{`「${payload.comment}」`}</p>
          </div>
        )}

        {/* Question if exists */}
        {payload.question && (
          <div className="mb-4 bg-amber-50 rounded-lg p-3 border border-amber-100">
            <p className="text-xs text-amber-600 mb-1">質問</p>
            <p className="text-sm text-amber-800">{payload.question}</p>
          </div>
        )}

        {/* Task Quick Actions */}
        {taskId && (
          <div className="mb-4 bg-gray-50 rounded-lg p-3 border border-gray-200">
            <p className="text-xs text-gray-500 mb-2">関連タスク</p>

            {taskLoading ? (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Spinner className="animate-spin" />
                <span>読み込み中...</span>
              </div>
            ) : task ? (
              <div className="space-y-3">
                {/* Task title */}
                <p className="text-sm font-medium text-gray-800">{task.title}</p>

                {/* Task description */}
                {task.description && (
                  <p className="text-sm text-gray-600 whitespace-pre-wrap line-clamp-4">{task.description}</p>
                )}

                {/* Status dropdown */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 w-16">ステータス</span>
                  <div className="relative flex-1">
                    <button
                      type="button"
                      onClick={() => setShowStatusMenu(!showStatusMenu)}
                      disabled={statusUpdating}
                      className="flex items-center gap-2 px-2 py-1.5 text-sm bg-white border border-gray-200 rounded-md hover:border-gray-300 transition-colors w-full"
                    >
                      {statusUpdating ? (
                        <Spinner className="animate-spin text-gray-400" />
                      ) : task.status === 'done' ? (
                        <CheckCircle weight="fill" className={getStatusColor(task.status)} />
                      ) : (
                        <Circle weight="fill" className={getStatusColor(task.status)} />
                      )}
                      <span className="flex-1 text-left">{getStatusLabel(task.status)}</span>
                      <CaretDown className="text-xs text-gray-400" />
                    </button>

                    {showStatusMenu && (
                      <>
                        <div
                          className="fixed inset-0 z-10"
                          onClick={() => setShowStatusMenu(false)}
                        />
                        <div className="absolute left-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-full">
                          {STATUS_OPTIONS.map((option) => (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => handleStatusChange(option.value)}
                              className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 transition-colors ${
                                task.status === option.value ? 'bg-blue-50' : ''
                              }`}
                            >
                              {option.value === 'done' ? (
                                <CheckCircle weight="fill" className={option.color} />
                              ) : (
                                <Circle weight="fill" className={option.color} />
                              )}
                              <span>{option.label}</span>
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Due date display */}
                {task.due_date && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 w-16">期限</span>
                    <div className="flex items-center gap-1.5 text-sm text-gray-700">
                      <Calendar className="text-sm" />
                      <span>{new Date(task.due_date).toLocaleDateString('ja-JP')}</span>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-500">
                {payload.task_title || 'タスク情報を取得できませんでした'}
              </p>
            )}
          </div>
        )}

        {/* Type-specific action panel */}
        {renderActionPanel()}

        {/* Meeting ended summary (AT-003, AT-004) */}
        {notification.type === 'meeting_ended' && payload.summary_body && (
          <div className="mb-4 bg-blue-50 rounded-lg p-3 border border-blue-100">
            <p className="text-xs text-blue-600 mb-2 font-medium">
              {payload.summary_subject || '会議終了'}
            </p>
            <div className="flex gap-4 mb-3 text-sm">
              <div className="text-center">
                <span className="block text-lg font-bold text-blue-700">
                  {payload.decided_count ?? 0}
                </span>
                <span className="text-xs text-blue-500">決定</span>
              </div>
              <div className="text-center">
                <span className="block text-lg font-bold text-amber-600">
                  {payload.open_count ?? 0}
                </span>
                <span className="text-xs text-amber-500">未決</span>
              </div>
              <div className="text-center">
                <span className="block text-lg font-bold text-orange-600">
                  {payload.ball_client_count ?? 0}
                </span>
                <span className="text-xs text-orange-500">要対応</span>
              </div>
            </div>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">
              {payload.summary_body}
            </p>
          </div>
        )}

        {/* Meeting info if exists (no task_id case) */}
        {!taskId && payload.meeting_title && notification.type !== 'meeting_ended' && (
          <div className="mb-4 bg-green-50 rounded-lg p-3">
            <p className="text-xs text-green-600 mb-1">関連ミーティング</p>
            <p className="text-sm text-green-800 font-medium">{payload.meeting_title}</p>
            {payload.scheduled_at && (
              <p className="text-xs text-green-600 mt-1">
                {formatDateTime(payload.scheduled_at)}
              </p>
            )}
          </div>
        )}

        {/* Due date if exists (no task case) */}
        {!taskId && payload.due_date && (
          <div className="mb-4 flex items-center gap-2 text-sm text-gray-600">
            <Calendar className="text-base" />
            <span>期限: {new Date(payload.due_date).toLocaleDateString('ja-JP')}</span>
          </div>
        )}
      </div>

      {/* Footer Actions — strict hierarchy: 1 Primary (filled) + 1 Secondary (outline) + 1 Ghost (text) */}
      <div className="flex-shrink-0 border-t border-gray-100 p-4 space-y-2">
        {/* Primary: Quick complete (when no type-specific action) */}
        {!hasTypeSpecificAction && task && task.status !== 'done' && (
          <button
            type="button"
            onClick={handleQuickComplete}
            disabled={statusUpdating}
            className="flex items-center justify-center gap-2 w-full px-4 py-2 text-sm font-medium text-white bg-gray-900 hover:bg-gray-800 disabled:opacity-50 rounded-md transition-colors"
          >
            <CheckCircle weight="fill" className="text-base" />
            <span>完了にして次へ</span>
          </button>
        )}

        {/* Secondary: Link to detail page (outline style) */}
        {payload.link && (
          <Link
            href={payload.link}
            className="flex items-center justify-center gap-2 w-full px-4 py-2 text-sm font-medium border border-gray-200 text-gray-700 hover:bg-gray-50 rounded-md transition-colors"
          >
            <span>詳細を見る</span>
            <ArrowSquareOut className="text-base" />
          </Link>
        )}

        {/* Ghost: Mark as read / next (text-only) */}
        <button
          type="button"
          onClick={handleMarkAsReadAndNext}
          className="flex items-center justify-center gap-2 w-full px-4 py-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          <span>{isUnread ? '既読にして次へ' : '次の通知へ'}</span>
          {hasNext && <CaretDown className="text-xs" />}
        </button>
      </div>
    </div>
  )
}
