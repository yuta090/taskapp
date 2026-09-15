'use client'

import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react'
import {
  ChatCircle,
  PaperPlaneTilt,
  Spinner,
  Trash,
  PencilSimple,
  Eye,
  EyeSlash,
} from '@phosphor-icons/react'
import Image from 'next/image'
import { useConfirmDialog } from '@/components/shared'
import { useTaskComments, type CommentWithProfile } from '@/lib/hooks/useTaskComments'
import { useMarkTaskCommentsReadWhenSeen } from '@/lib/hooks/useUnreadTaskComments'
import { useSpaceMembers, type SpaceMember } from '@/lib/hooks/useSpaceMembers'
import {
  detectMentionQuery,
  getMentionCandidates,
  resolveMentionUserIds,
  splitCommentBody,
  type MentionSelection,
} from '@/lib/comments/mentions'
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
  members: SpaceMember[]
  onEdit: (commentId: string, body: string) => Promise<void>
  onDelete: (commentId: string) => Promise<void>
}

/** コメント本文を表示用に分け、@表示名 だけ色を付けて返す */
function CommentBody({ body, mentionUserIds, members }: { body: string; mentionUserIds: string[]; members: SpaceMember[] }) {
  const segments = splitCommentBody(body, mentionUserIds, members)
  return (
    <>
      {segments.map((segment, i) =>
        segment.type === 'mention' ? (
          <span key={i} className="text-indigo-ink font-medium">
            {segment.value}
          </span>
        ) : (
          <span key={i}>{segment.value}</span>
        )
      )}
    </>
  )
}

const CommentItem = memo(function CommentItem({
  comment,
  currentUserId,
  canEdit,
  members,
  onEdit,
  onDelete,
}: CommentItemProps) {
  const { confirm, ConfirmDialog } = useConfirmDialog()
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
    const ok = await confirm({
      title: 'コメントを削除',
      message: 'このコメントを削除しますか？',
      confirmLabel: '削除',
      variant: 'danger',
    })
    if (!ok) return
    setIsDeleting(true)
    try {
      await onDelete(comment.id)
    } catch {
      setIsDeleting(false)
    }
  }

  return (
    <div className={`group py-3 ${isDeleting ? 'opacity-50' : ''}`}>
      {ConfirmDialog}
      <div className="flex items-start gap-2">
        {/* Avatar */}
        {comment.actor_avatar_url ? (
          <Image
            src={comment.actor_avatar_url}
            alt=""
            width={28}
            height={28}
            className="w-7 h-7 rounded-full object-cover flex-shrink-0"
            unoptimized
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
                  className="px-2 py-1 text-xs text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 rounded"
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
              <CommentBody body={comment.body} mentionUserIds={comment.mention_user_ids ?? []} members={members} />
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
})

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
  // 既読の目印にする「自分以外の最新のコメント」。お知らせは自分以外が書いたコメントにだけ届く
  const latestOthersComment = useMemo(() => {
    for (let i = comments.length - 1; i >= 0; i--) {
      const comment = comments[i]
      if (comment.actor_id !== currentUserId) return { id: comment.id, createdAt: comment.created_at }
    }
    return null
  }, [comments, currentUserId])
  const { members } = useSpaceMembers(spaceId)

  const [newComment, setNewComment] = useState('')
  const [visibility, setVisibility] = useState<CommentVisibility>('internal')
  const [isSending, setIsSending] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const commentsEndRef = useRef<HTMLDivElement>(null)
  const prevCommentsLengthRef = useRef<number>(0)

  // 自分宛ての未読のコメント（受信トレイのお知らせ）は、コメント一覧の末尾が画面に入ったとき＝いちばん新しい
  // コメントまで見えたときに既読にする。一覧は古い順で、枠の中の下に新しいコメントが隠れていることがある
  useMarkTaskCommentsReadWhenSeen({ taskId, orgId, latestComment: latestOthersComment, targetRef: commentsEndRef })

  // 公開範囲が選べない画面（クライアントポータル等）は常に 'client' 扱い
  const effectiveVisibility: CommentVisibility = canSetVisibility ? visibility : 'client'

  // ── @メンション ──
  const [mentionState, setMentionState] = useState<{ start: number; query: string; activeIndex: number } | null>(null)
  const [selectedMentions, setSelectedMentions] = useState<MentionSelection[]>([])
  const [cursorToSet, setCursorToSet] = useState<number | null>(null)

  const mentionCandidates = useMemo(() => {
    if (!mentionState) return []
    return getMentionCandidates(members, {
      visibility: effectiveVisibility,
      currentUserId,
      query: mentionState.query,
    }).slice(0, 8)
  }, [mentionState, members, effectiveVisibility, currentUserId])

  // 候補を選んだ直後にカーソル位置を差し込んだメンションの後ろへ動かす
  useEffect(() => {
    if (cursorToSet === null) return
    const el = textareaRef.current
    if (el) {
      el.focus()
      el.setSelectionRange(cursorToSet, cursorToSet)
    }
    setCursorToSet(null)
  }, [cursorToSet, newComment])

  const selectMention = useCallback(
    (candidate: SpaceMember) => {
      if (!mentionState) return
      const { start, query } = mentionState
      const before = newComment.slice(0, start)
      const after = newComment.slice(start + 1 + query.length)
      const insertText = `@${candidate.displayName} `
      setNewComment(before + insertText + after)
      setSelectedMentions((list) => [...list, { id: candidate.id, displayName: candidate.displayName }])
      setMentionState(null)
      setCursorToSet(before.length + insertText.length)
    },
    [mentionState, newComment]
  )

  // カーソル位置（クリック・矢印キーでの移動を含む）から @候補を取り直す。
  // 文字を打ったとき以外は開閉されず、古い @ の位置のまま選ばれてしまうのを防ぐ
  const refreshMentionStateFromCursor = useCallback((el: HTMLTextAreaElement) => {
    const cursor = el.selectionStart ?? el.value.length
    const detected = detectMentionQuery(el.value, cursor)
    setMentionState(detected ? { ...detected, activeIndex: 0 } : null)
  }, [])

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

    // 見える範囲の外に落ちた人は resolveMentionUserIds が落とす
    const allowedCandidates = getMentionCandidates(members, {
      visibility: effectiveVisibility,
      currentUserId,
    })
    const mentionUserIds = resolveMentionUserIds(newComment, selectedMentions, allowedCandidates)

    setIsSending(true)
    try {
      await createComment({
        body: newComment.trim(),
        visibility: effectiveVisibility,
        mentionUserIds,
      })
      setNewComment('')
      setSelectedMentions([])
      setMentionState(null)
      textareaRef.current?.focus()
    } finally {
      setIsSending(false)
    }
  }, [newComment, isSending, createComment, effectiveVisibility, members, currentUserId, selectedMentions])

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

  const handleTextareaChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setNewComment(value)
    const cursor = e.target.selectionStart ?? value.length
    const detected = detectMentionQuery(value, cursor)
    setMentionState(detected ? { ...detected, activeIndex: 0 } : null)
  }, [])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // 日本語入力の変換中の Enter は変換の確定。候補の決定や送信に使わない
      if (e.nativeEvent.isComposing || e.keyCode === 229) return

      // 候補が開いている間は、まず一覧の操作を優先する
      // （Cmd/Ctrl+Enter の送信とはぶつからないよう、修飾キー無しの Enter だけ横取りする）
      if (mentionState && mentionCandidates.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setMentionState((prev) => (prev ? { ...prev, activeIndex: (prev.activeIndex + 1) % mentionCandidates.length } : prev))
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setMentionState((prev) =>
            prev ? { ...prev, activeIndex: (prev.activeIndex - 1 + mentionCandidates.length) % mentionCandidates.length } : prev
          )
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          setMentionState(null)
          return
        }
        if (e.key === 'Tab' || (e.key === 'Enter' && !e.metaKey && !e.ctrlKey)) {
          e.preventDefault()
          // 公開範囲の切り替え等で候補が減ったあとでも、選択中の番号を候補の
          // 件数に丸めてから使う（undefined を selectMention に渡さない）
          const index = Math.min(mentionState.activeIndex, mentionCandidates.length - 1)
          selectMention(mentionCandidates[index])
          return
        }
      }

      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend, mentionState, mentionCandidates, selectMention]
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
                members={members}
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
        <div className="relative">
          {mentionState && mentionCandidates.length > 0 && (
            <div
              role="listbox"
              aria-label="メンション候補"
              // 候補が多いとスクロールバーが出る。つかむと入力欄のフォーカスが外れ、blur で一覧が閉じるので、
              // 一覧の中の mousedown ではフォーカスを動かさない（候補のボタンと同じ扱い）
              onMouseDown={(e) => e.preventDefault()}
              className="absolute bottom-full left-0 mb-1 w-64 max-h-48 overflow-y-auto bg-surface border border-gray-200 rounded-lg shadow-popover z-20 py-1"
            >
              {mentionCandidates.map((candidate, i) => (
                <button
                  key={candidate.id}
                  type="button"
                  role="option"
                  aria-selected={i === mentionState.activeIndex}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    selectMention(candidate)
                  }}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 text-xs text-left ${
                    i === mentionState.activeIndex ? 'bg-indigo-50 text-indigo-ink' : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {candidate.avatarUrl ? (
                    <Image
                      src={candidate.avatarUrl}
                      alt=""
                      width={20}
                      height={20}
                      className="w-5 h-5 rounded-full object-cover flex-shrink-0"
                      unoptimized
                    />
                  ) : (
                    <div className="w-5 h-5 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center text-[10px] font-medium flex-shrink-0">
                      {candidate.displayName.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <span className="truncate">{candidate.displayName}</span>
                </button>
              ))}
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={newComment}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            onSelect={(e) => refreshMentionStateFromCursor(e.currentTarget)}
            onClick={(e) => refreshMentionStateFromCursor(e.currentTarget)}
            // 候補のクリックは各ボタンの onMouseDown で先に確定するので、
            // ここで一覧を閉じても選択の妨げにはならない
            onBlur={() => setMentionState(null)}
            placeholder="コメントを入力...（@で名前を呼ぶと通知が届きます・Cmd+Enter で送信）"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            rows={2}
            disabled={isSending}
          />
        </div>

        <div className="flex items-center justify-between">
          {/* Visibility toggle (internal members only) */}
          {canSetVisibility && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setVisibility('client')
                  // 公開範囲が変わると @候補の見える範囲も変わるので、開いていた一覧は閉じる
                  setMentionState(null)
                }}
                className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors ${
                  visibility === 'client'
                    ? 'bg-amber-100 text-amber-700 font-medium'
                    : 'text-gray-500 hover:bg-gray-100'
                }`}
              >
                <Eye className="text-xs" />
                外部に公開
              </button>
              <button
                type="button"
                onClick={() => {
                  setVisibility('internal')
                  setMentionState(null)
                }}
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
            className="flex items-center gap-1 px-3 py-1.5 text-xs text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
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
