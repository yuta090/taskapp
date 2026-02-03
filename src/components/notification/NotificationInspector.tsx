'use client'

import { useCallback, useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import {
  X,
  CheckCircle,
  Bell,
  ChatCircleText,
  Calendar,
  Warning,
  ArrowRight,
  Eye,
  CaretUp,
  CaretDown,
  Check,
  ArrowSquareOut,
  Circle,
  Spinner,
} from '@phosphor-icons/react'
import { createClient } from '@/lib/supabase/client'
import type { NotificationWithPayload } from '@/lib/hooks/useNotifications'
import type { Task, TaskStatus } from '@/types/database'

interface NotificationInspectorProps {
  notification: NotificationWithPayload
  onClose: () => void
  onMarkAsRead: (id: string) => void
  onNavigate: (direction: 'prev' | 'next') => void
  hasPrev: boolean
  hasNext: boolean
}

const STATUS_OPTIONS: { value: TaskStatus; label: string; color: string }[] = [
  { value: 'backlog', label: 'バックログ', color: 'text-gray-400' },
  { value: 'todo', label: 'Todo', color: 'text-gray-500' },
  { value: 'in_progress', label: '進行中', color: 'text-blue-500' },
  { value: 'in_review', label: 'レビュー中', color: 'text-purple-500' },
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
      return <Bell className={`${iconClass} text-purple-500`} />
    default:
      return <Bell className={`${iconClass} text-gray-500`} />
  }
}

function getNotificationTypeLabel(type: string): string {
  switch (type) {
    case 'review_request': return 'レビュー依頼'
    case 'client_question': return 'クライアントからの質問'
    case 'client_feedback': return 'クライアントからのフィードバック'
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
  onNavigate,
  hasPrev,
  hasNext,
}: NotificationInspectorProps) {
  const payload = notification.payload
  const isUnread = notification.read_at === null
  const isUrgent = payload.urgent === true
  const taskId = payload.task_id

  // Task state
  const [task, setTask] = useState<Task | null>(null)
  const [taskLoading, setTaskLoading] = useState(false)
  const [statusUpdating, setStatusUpdating] = useState(false)
  const [showStatusMenu, setShowStatusMenu] = useState(false)

  const supabase = useMemo(() => createClient(), [])

  // Fetch task if notification has task_id (with race condition guard)
  useEffect(() => {
    if (!taskId) {
      setTask(null)
      return
    }

    let cancelled = false

    const fetchTask = async () => {
      setTaskLoading(true)
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
          .from('tasks')
          .select('*')
          .eq('id', taskId)
          .single()

        if (error) throw error
        // Guard against stale responses
        if (!cancelled) {
          setTask(data)
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
  }, [taskId, supabase])

  // Update task status - returns true on success, false on failure
  const handleStatusChange = useCallback(async (newStatus: TaskStatus): Promise<boolean> => {
    if (!task) return false

    const prevStatus = task.status
    setStatusUpdating(true)
    setShowStatusMenu(false)

    // Optimistic update
    setTask(prev => prev ? { ...prev, status: newStatus } : null)

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from('tasks')
        .update({ status: newStatus })
        .eq('id', task.id)

      if (error) throw error
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
    if (!success) {
      // Status update failed, don't mark as read or navigate
      return
    }

    // Only mark notification as read and go to next if update succeeded
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

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="flex-shrink-0 h-12 border-b border-gray-100 flex items-center px-4 gap-2">
        <div className="flex-1 flex items-center gap-2 min-w-0">
          <span className="text-xs text-gray-500 truncate">
            {getNotificationTypeLabel(notification.type)}
          </span>
          {isUnread && (
            <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
          )}
          {isUrgent && (
            <span className="text-[10px] px-1.5 py-0.5 bg-red-100 text-red-600 rounded font-medium">
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
            <p className="text-sm text-gray-700">「{payload.comment}」</p>
          </div>
        )}

        {/* Question if exists */}
        {payload.question && (
          <div className="mb-4 bg-amber-50 rounded-lg p-3 border border-amber-100">
            <p className="text-xs text-amber-600 mb-1">質問</p>
            <p className="text-sm text-amber-800">{payload.question}</p>
          </div>
        )}

        {/* Task Quick Actions - NEW */}
        {taskId && (
          <div className="mb-4 bg-slate-50 rounded-lg p-3 border border-slate-200">
            <p className="text-xs text-slate-500 mb-2">関連タスク</p>

            {taskLoading ? (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Spinner className="animate-spin" />
                <span>読み込み中...</span>
              </div>
            ) : task ? (
              <div className="space-y-3">
                {/* Task title */}
                <p className="text-sm font-medium text-slate-800">{task.title}</p>

                {/* Status dropdown */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 w-16">ステータス</span>
                  <div className="relative flex-1">
                    <button
                      type="button"
                      onClick={() => setShowStatusMenu(!showStatusMenu)}
                      disabled={statusUpdating}
                      className="flex items-center gap-2 px-2 py-1.5 text-sm bg-white border border-slate-200 rounded-md hover:border-slate-300 transition-colors w-full"
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
                    <span className="text-xs text-slate-500 w-16">期限</span>
                    <div className="flex items-center gap-1.5 text-sm text-slate-700">
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

      {/* Footer Actions */}
      <div className="flex-shrink-0 border-t border-gray-100 p-4 space-y-2">
        {/* Quick complete button for tasks */}
        {task && task.status !== 'done' && (
          <button
            type="button"
            onClick={handleQuickComplete}
            disabled={statusUpdating}
            className="flex items-center justify-center gap-2 w-full px-4 py-2 text-sm font-medium text-white bg-green-500 hover:bg-green-600 disabled:opacity-50 rounded-lg transition-colors"
          >
            <CheckCircle weight="fill" className="text-base" />
            <span>完了にして次へ</span>
          </button>
        )}

        {/* Link to detail page */}
        {payload.link && (
          <Link
            href={payload.link}
            className={`flex items-center justify-center gap-2 w-full px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              task && task.status !== 'done'
                ? 'text-blue-600 bg-blue-50 hover:bg-blue-100'
                : 'text-white bg-blue-500 hover:bg-blue-600'
            }`}
          >
            <span>詳細を見る</span>
            <ArrowSquareOut className="text-base" />
          </Link>
        )}

        {/* Mark as read and next */}
        <button
          type="button"
          onClick={handleMarkAsReadAndNext}
          className={`flex items-center justify-center gap-2 w-full px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
            isUnread
              ? 'text-gray-700 bg-gray-100 hover:bg-gray-200'
              : 'text-gray-500 bg-gray-50 hover:bg-gray-100'
          }`}
        >
          <Check className="text-base" />
          <span>{isUnread ? '既読にして次へ' : '次の通知へ'}</span>
          {hasNext && <CaretDown className="text-sm" />}
        </button>
      </div>
    </div>
  )
}
