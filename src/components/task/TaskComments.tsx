'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  ChatCircle,
  PaperPlaneTilt,
  Spinner,
  Trash,
  PencilSimple,
  Check,
  X,
  Eye,
  EyeSlash,
} from '@phosphor-icons/react'
import { useTaskComments, type CommentWithProfile } from '@/lib/hooks/useTaskComments'
import type { CommentVisibility } from '@/types/database'

interface TaskCommentsProps {
  orgId: string
  spaceId: string
  taskId: string
  currentUserId: string | null
  /** If true, only show client-visible comments (for client portal) */
  clientOnly?: boolean
  /** If true, user is internal member and can set visibility */
  canSetVisibility?: boolean
}

function formatCommentTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMinutes = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffMinutes < 1) return 'たった今'
  if (diffMinutes < 60) return `${diffMinutes}分前`
  if (diffHours < 24) return `${diffHours}時間前`
  if (diffDays < 7) return `${diffDays}日前`

  return date.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })
}

interface CommentItemProps {
  comment: CommentWithProfile
  currentUserId: string | null
  canEdit: boolean
  onEdit: (commentId: string, body: string) => Promise<void>
  onDelete: (commentId: string) => Promise<void>
}

function CommentItem({ comment, currentUserId, canEdit, onEdit, onDelete }: CommentItemProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editBody, setEditBody] = useState(comment.body)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const isAuthor = comment.actor_id === currentUserId

  const handleSave = async () => {
    if (!editBody.trim() || editBody === comment.body) {
      setEditBody(comment.body)
      setIsEditing(false)
      return
    }
    setIsSaving(true)
    try {
      await onEdit(comment.id, editBody.trim())
      setIsEditing(false)
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm('このコメントを削除しますか？')) return
    setIsDeleting(true)
    try {
      await onDelete(comment.id)
    } catch {
      setIsDeleting(false)
    }
  }

  return (
    <div className={`group py-3 ${isDeleting ? 'opacity-50' : ''}`}>
      <div className="flex items-start gap-2">
        {/* Avatar */}
        {comment.actor_avatar_url ? (
          <img
            src={comment.actor_avatar_url}
            alt=""
            className="w-7 h-7 rounded-full object-cover flex-shrink-0"
          />
        ) : (
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center text-xs font-medium flex-shrink-0">
            {(comment.actor_name || '?').charAt(0).toUpperCase()}
          </div>
        )}

        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-900">
              {comment.actor_name}
            </span>
            <span className="text-[10px] text-gray-400">
              {formatCommentTime(comment.created_at)}
            </span>
            {comment.visibility === 'internal' && (
              <span className="text-[10px] px-1 py-0.5 bg-gray-100 text-gray-500 rounded flex items-center gap-0.5">
                <EyeSlash className="text-[10px]" />
                社内のみ
              </span>
            )}
            {comment.updated_at !== comment.created_at && (
              <span className="text-[10px] text-gray-400">(編集済み)</span>
            )}
          </div>

          {/* Body */}
          {isEditing ? (
            <div className="mt-1 space-y-2">
              <textarea
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setEditBody(comment.body)
                    setIsEditing(false)
                  }
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    handleSave()
                  }
                }}
                className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                rows={2}
                autoFocus
                disabled={isSaving}
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSave}
                  disabled={isSaving || !editBody.trim()}
                  className="px-2 py-1 text-xs text-white bg-gray-900 hover:bg-gray-800 disabled:bg-gray-300 rounded"
                >
                  {isSaving ? <Spinner className="animate-spin" /> : '保存'}
                </button>
                <button
                  onClick={() => {
                    setEditBody(comment.body)
                    setIsEditing(false)
                  }}
                  disabled={isSaving}
                  className="px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded"
                >
                  キャンセル
                </button>
              </div>
            </div>
          ) : (
            <p className="mt-0.5 text-sm text-gray-700 whitespace-pre-wrap break-words">
              {comment.body}
            </p>
          )}
        </div>

        {/* Actions */}
        {isAuthor && canEdit && !isEditing && (
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => setIsEditing(true)}
              className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
              title="編集"
            >
              <PencilSimple className="text-sm" />
            </button>
            <button
              onClick={handleDelete}
              disabled={isDeleting}
              className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
              title="削除"
            >
              <Trash className="text-sm" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export function TaskComments({
  orgId,
  spaceId,
  taskId,
  currentUserId,
  clientOnly = false,
  canSetVisibility = false,
}: TaskCommentsProps) {
  const {
    comments,
    loading,
    error,
    fetchComments,
    createComment,
    updateComment,
    softDeleteComment,
    canEdit,
  } = useTaskComments({ orgId, spaceId, taskId, clientOnly })

  const [newComment, setNewComment] = useState('')
  const [visibility, setVisibility] = useState<CommentVisibility>('client')
  const [isSending, setIsSending] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const commentsEndRef = useRef<HTMLDivElement>(null)
  const prevCommentsLengthRef = useRef<number>(0)

  // Fetch comments on mount
  useEffect(() => {
    fetchComments()
  }, [fetchComments])

  // Reset scroll tracking when task changes
  useEffect(() => {
    prevCommentsLengthRef.current = 0
  }, [taskId])

  // Scroll to bottom only when new comment is added (not on initial load or task switch)
  useEffect(() => {
    // Only scroll if comments increased (new comment added), not on initial load
    if (prevCommentsLengthRef.current > 0 && comments.length > prevCommentsLengthRef.current) {
      commentsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
    prevCommentsLengthRef.current = comments.length
  }, [comments.length])

  const handleSend = useCallback(async () => {
    if (!newComment.trim() || isSending) return

    setIsSending(true)
    try {
      await createComment({
        body: newComment.trim(),
        visibility: canSetVisibility ? visibility : 'client',
      })
      setNewComment('')
      textareaRef.current?.focus()
    } finally {
      setIsSending(false)
    }
  }, [newComment, isSending, createComment, canSetVisibility, visibility])

  const handleEdit = useCallback(
    async (commentId: string, body: string) => {
      await updateComment(commentId, { body })
    },
    [updateComment]
  )

  const handleDelete = useCallback(
    async (commentId: string) => {
      await softDeleteComment(commentId)
    },
    [softDeleteComment]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend]
  )

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <ChatCircle className="text-gray-400" />
        <label className="text-xs font-medium text-gray-500">
          コメント
          {comments.length > 0 && (
            <span className="ml-1 text-gray-400">({comments.length})</span>
          )}
        </label>
      </div>

      {/* Comments list */}
      <div className="max-h-64 overflow-y-auto">
        {loading && comments.length === 0 ? (
          <div className="flex items-center justify-center py-4 text-gray-400">
            <Spinner className="animate-spin mr-2" />
            <span className="text-xs">読み込み中...</span>
          </div>
        ) : error ? (
          <div className="text-xs text-red-500 py-2">{error.message}</div>
        ) : comments.length === 0 ? (
          <div className="text-xs text-gray-400 py-4 text-center">
            コメントはまだありません
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {comments.map((comment) => (
              <CommentItem
                key={comment.id}
                comment={comment}
                currentUserId={currentUserId}
                canEdit={currentUserId ? canEdit(comment, currentUserId) : false}
                onEdit={handleEdit}
                onDelete={handleDelete}
              />
            ))}
            <div ref={commentsEndRef} />
          </div>
        )}
      </div>

      {/* New comment input */}
      <div className="space-y-2">
        <textarea
          ref={textareaRef}
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="コメントを入力... (Cmd+Enter で送信)"
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          rows={2}
          disabled={isSending}
        />

        <div className="flex items-center justify-between">
          {/* Visibility toggle (internal members only) */}
          {canSetVisibility && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setVisibility('client')}
                className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors ${
                  visibility === 'client'
                    ? 'bg-amber-100 text-amber-700 font-medium'
                    : 'text-gray-500 hover:bg-gray-100'
                }`}
              >
                <Eye className="text-xs" />
                クライアントに表示
              </button>
              <button
                type="button"
                onClick={() => setVisibility('internal')}
                className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors ${
                  visibility === 'internal'
                    ? 'bg-gray-200 text-gray-700 font-medium'
                    : 'text-gray-500 hover:bg-gray-100'
                }`}
              >
                <EyeSlash className="text-xs" />
                社内のみ
              </button>
            </div>
          )}

          {!canSetVisibility && <div />}

          {/* Send button */}
          <button
            type="button"
            onClick={handleSend}
            disabled={!newComment.trim() || isSending}
            className="flex items-center gap-1 px-3 py-1.5 text-xs text-white bg-gray-900 hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
          >
            {isSending ? (
              <Spinner className="animate-spin" />
            ) : (
              <PaperPlaneTilt className="text-sm" />
            )}
            <span>送信</span>
          </button>
        </div>
      </div>
    </div>
  )
}
