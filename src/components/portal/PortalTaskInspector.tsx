'use client'

import { useState, useEffect } from 'react'
import {
  X,
  Calendar,
  Clock,
  Tag,
  Check,
  ArrowCounterClockwise,
  ChatCircle,
} from '@phosphor-icons/react'

interface Task {
  id: string
  title: string
  description?: string | null
  status?: string
  dueDate?: string | null
  isOverdue?: boolean
  waitingDays?: number
  type?: 'task' | 'spec'
  createdAt?: string
  comments?: Comment[]
}

interface Comment {
  id: string
  content: string
  createdAt: string
  author?: {
    name: string
    isClient?: boolean
  }
}

interface PortalTaskInspectorProps {
  task: Task
  onClose: () => void
  onApprove?: (taskId: string, comment: string) => Promise<void>
  onRequestChanges?: (taskId: string, comment: string) => Promise<void>
}

function formatDate(date: string): string {
  const d = new Date(date)
  return d.toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  })
}

function formatDateTime(date: string): string {
  const d = new Date(date)
  return d.toLocaleString('ja-JP', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getStatusLabel(status?: string): { label: string; color: string } {
  if (!status) return { label: '不明', color: 'bg-gray-100 text-gray-700' }
  const statusMap: Record<string, { label: string; color: string }> = {
    considering: { label: '確認待ち', color: 'bg-gray-100 text-gray-600' },
    open: { label: '対応待ち', color: 'bg-blue-50 text-blue-600' },
    in_progress: { label: '進行中', color: 'bg-blue-50 text-blue-600' },
    todo: { label: 'Todo', color: 'bg-gray-100 text-gray-600' },
    done: { label: '完了', color: 'bg-green-50 text-green-600' },
  }
  return statusMap[status] || { label: status, color: 'bg-gray-100 text-gray-600' }
}

export function PortalTaskInspector({
  task,
  onClose,
  onApprove,
  onRequestChanges,
}: PortalTaskInspectorProps) {
  const [comment, setComment] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [activeAction, setActiveAction] = useState<'approve' | 'request_changes' | null>(null)

  // Reset state when task changes to prevent comment from persisting across tasks
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional state reset when task.id changes
    setComment('')
    setActiveAction(null)
    setIsSubmitting(false)
  }, [task.id])

  const statusInfo = getStatusLabel(task.status)
  // ball='client' のタスクは全て承認/修正依頼可能
  const showActions = onApprove || onRequestChanges

  const handleApprove = () => {
    if (!onApprove || isSubmitting) return
    setIsSubmitting(true)
    setActiveAction('approve')
    // Fire and forget — parent handles optimistic removal
    onApprove(task.id, comment)
  }

  const handleRequestChanges = () => {
    if (!onRequestChanges || isSubmitting || !comment.trim()) return
    setIsSubmitting(true)
    setActiveAction('request_changes')
    // Fire and forget — parent handles optimistic removal
    onRequestChanges(task.id, comment)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 shrink-0">
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 text-xs font-medium rounded ${statusInfo.color}`}>
            {statusInfo.label}
          </span>
          {task.type === 'spec' && (
            <span className="px-2 py-0.5 text-xs font-medium rounded bg-gray-100 text-gray-600">
              仕様
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Title & Description */}
        <div className="px-4 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">{task.title}</h2>
          {task.description && (
            <p className="mt-2 text-sm text-gray-600 whitespace-pre-wrap">
              {task.description}
            </p>
          )}
        </div>

        {/* Action Panel - description直下に配置 */}
        {showActions && (
          <div className="px-4 py-4 border-b border-gray-100 bg-gray-50/50">
            {/* Comment Input */}
            <div className="relative">
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="コメントを入力（修正依頼時は必須）"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 bg-white"
                rows={2}
                disabled={isSubmitting}
              />
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2 mt-6">
              <button
                onClick={handleApprove}
                disabled={isSubmitting}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {activeAction === 'approve' && isSubmitting ? (
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <Check className="w-4 h-4" weight="bold" />
                )}
                承認
              </button>
              <button
                onClick={handleRequestChanges}
                disabled={isSubmitting || !comment.trim()}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-sm font-medium text-amber-700 bg-amber-100 hover:bg-amber-200 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {activeAction === 'request_changes' && isSubmitting ? (
                  <span className="w-4 h-4 border-2 border-amber-500/30 border-t-amber-500 rounded-full animate-spin" />
                ) : (
                  <ArrowCounterClockwise className="w-4 h-4" weight="bold" />
                )}
                修正依頼
              </button>
            </div>

            {!comment.trim() && (
              <p className="text-xs text-gray-400 mt-2">
                ※ 修正依頼にはコメントが必要です
              </p>
            )}
          </div>
        )}

        {/* Meta Info */}
        <div className="px-4 py-3 border-b border-gray-100 space-y-2">
          {task.dueDate && (
            <div className="flex items-center gap-2 text-sm">
              <Calendar className={`w-4 h-4 ${task.isOverdue ? 'text-red-500' : 'text-gray-400'}`} />
              <span className={task.isOverdue ? 'text-red-600 font-medium' : 'text-gray-600'}>
                期限: {formatDate(task.dueDate)}
                {task.isOverdue && ' (期限切れ)'}
              </span>
            </div>
          )}
          {task.waitingDays !== undefined && task.waitingDays > 0 && (
            <div className="flex items-center gap-2 text-sm">
              <Clock className="w-4 h-4 text-gray-400" />
              <span className="text-gray-600">
                待機: {task.waitingDays}日
              </span>
            </div>
          )}
          {task.createdAt && (
            <div className="flex items-center gap-2 text-sm">
              <Tag className="w-4 h-4 text-gray-400" />
              <span className="text-gray-600">
                作成: {formatDateTime(task.createdAt)}
              </span>
            </div>
          )}
        </div>

        {/* Comments */}
        {task.comments && task.comments.length > 0 && (
          <div className="px-4 py-3 border-b border-gray-100">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-3">
              <ChatCircle className="w-4 h-4" />
              コメント ({task.comments.length})
            </div>
            <div className="space-y-3">
              {task.comments.map((c) => (
                <div key={c.id} className="text-sm">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`font-medium ${c.author?.isClient ? 'text-amber-700' : 'text-gray-700'}`}>
                      {c.author?.name || '不明'}
                    </span>
                    <span className="text-xs text-gray-400">
                      {formatDateTime(c.createdAt)}
                    </span>
                  </div>
                  <p className="text-gray-600 whitespace-pre-wrap">{c.content}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

    </div>
  )
}
