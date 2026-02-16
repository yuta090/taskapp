'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  CheckCircle,
  XCircle,
  Clock,
  User,
  ChatText,
  Eye,
} from '@phosphor-icons/react'
import { createClient } from '@/lib/supabase/client'
import { rpc } from '@/lib/supabase/rpc'
import { useCurrentUser } from '@/lib/hooks/useCurrentUser'
import { useSpaceMembers } from '@/lib/hooks/useSpaceMembers'
import type { Review, ReviewApproval } from '@/types/database'

interface TaskReviewSectionProps {
  taskId: string
  spaceId: string
  orgId: string
  taskStatus?: string
  readOnly?: boolean
  onReviewChange?: (taskId: string, status: string | null) => void
}

interface ReviewData {
  review: Review
  approvals: ReviewApproval[]
}

export function TaskReviewSection({
  taskId,
  spaceId,
  taskStatus,
  readOnly = false,
  onReviewChange,
}: TaskReviewSectionProps) {
  const [reviewData, setReviewData] = useState<ReviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [showReviewerPicker, setShowReviewerPicker] = useState(false)
  const [selectedReviewerIds, setSelectedReviewerIds] = useState<string[]>([])
  const [showBlockForm, setShowBlockForm] = useState(false)
  const [blockReason, setBlockReason] = useState('')

  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  const { user } = useCurrentUser()
  const { internalMembers, getMemberName } = useSpaceMembers(spaceId)

  // Fetch review for this task.
  // Returns { ok: true, status } on success, { ok: false } on failure.
  // Callers should only propagate status changes when ok=true.
  const fetchReview = useCallback(async (): Promise<{ ok: true; status: string | null } | { ok: false }> => {
    try {
      const { data, error } = await supabase
        .from('reviews')
        .select('*, review_approvals(*)')
        .eq('task_id' as never, taskId as never)
        .single()

      if (error && error.code === 'PGRST116') {
        // No review found
        setReviewData(null)
        return { ok: true, status: null }
      }
      if (error) throw error

      const raw = data as Record<string, unknown> & { review_approvals?: unknown[] }
      const { review_approvals, ...reviewFields } = raw
      setReviewData({
        review: reviewFields as Review,
        approvals: (Array.isArray(review_approvals)
          ? review_approvals
          : []) as ReviewApproval[],
      })
      return { ok: true, status: (reviewFields as Review).status }
    } catch (err) {
      console.error('Failed to fetch review:', err)
      setReviewData(null)
      return { ok: false }
    } finally {
      setLoading(false)
    }
  }, [taskId, supabase])

  useEffect(() => {
    void fetchReview()
  }, [fetchReview])

  // Auto-expand reviewer picker when status is in_review and no review exists
  useEffect(() => {
    if (!loading && taskStatus === 'in_review' && !reviewData && !readOnly) {
      setShowReviewerPicker(true)
    }
  }, [loading, taskStatus, reviewData, readOnly])

  // Open review
  const handleOpenReview = useCallback(async () => {
    if (selectedReviewerIds.length === 0) return
    setSubmitting(true)
    try {
      await rpc.reviewOpen(supabase, {
        taskId,
        reviewerIds: selectedReviewerIds,
      })
      setShowReviewerPicker(false)
      setSelectedReviewerIds([])
      const result = await fetchReview()
      if (result.ok) onReviewChange?.(taskId, result.status)
    } catch (err) {
      console.error('Failed to open review:', err)
    } finally {
      setSubmitting(false)
    }
  }, [taskId, selectedReviewerIds, supabase, fetchReview, onReviewChange])

  // Approve
  const handleApprove = useCallback(async () => {
    setSubmitting(true)
    try {
      await rpc.reviewApprove(supabase, { taskId })
      const result = await fetchReview()
      if (result.ok) onReviewChange?.(taskId, result.status)
    } catch (err) {
      console.error('Failed to approve:', err)
    } finally {
      setSubmitting(false)
    }
  }, [taskId, supabase, fetchReview, onReviewChange])

  // Block
  const handleBlock = useCallback(async () => {
    if (!blockReason.trim()) return
    setSubmitting(true)
    try {
      await rpc.reviewBlock(supabase, {
        taskId,
        blockedReason: blockReason.trim(),
      })
      setBlockReason('')
      setShowBlockForm(false)
      const result = await fetchReview()
      if (result.ok) onReviewChange?.(taskId, result.status)
    } catch (err) {
      console.error('Failed to block:', err)
    } finally {
      setSubmitting(false)
    }
  }, [taskId, blockReason, supabase, fetchReview, onReviewChange])

  const toggleReviewer = (userId: string) => {
    setSelectedReviewerIds((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId]
    )
  }

  const isCurrentUserReviewer =
    reviewData?.approvals.some(
      (a) => a.reviewer_id === user?.id && a.state === 'pending'
    ) ?? false

  if (loading) {
    return (
      <div className="px-4 py-3">
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Eye className="text-sm" />
          <span>承認フロー</span>
        </div>
      </div>
    )
  }

  return (
    <div className={`py-3 space-y-3 rounded-lg transition-colors ${
      taskStatus === 'in_review' && !reviewData && !loading
        ? 'bg-gray-50 ring-1 ring-gray-200 px-3'
        : 'px-4'
    }`}>
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-medium text-gray-500">
          <Eye className="text-sm" />
          <span>承認フロー</span>
        </div>
        {!readOnly && !reviewData && !showReviewerPicker && (
          <button
            onClick={() => setShowReviewerPicker(true)}
            className="text-xs text-gray-500 hover:text-gray-700 font-medium"
          >
            承認を依頼
          </button>
        )}
        {!readOnly && reviewData && reviewData.review.status !== 'open' && (
          <button
            onClick={() => {
              // Pre-select existing reviewers for re-review
              setSelectedReviewerIds(
                reviewData.approvals.map((a) => a.reviewer_id)
              )
              setShowReviewerPicker(true)
            }}
            className="text-xs text-gray-500 hover:text-gray-700 font-medium"
          >
            再依頼
          </button>
        )}
      </div>

      {/* Reviewer picker */}
      {showReviewerPicker && (
        <div className="space-y-2 p-3 bg-gray-50 rounded-lg">
          <p className="text-xs text-gray-500">承認者を選択</p>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {internalMembers
              .filter((m) => m.id !== user?.id)
              .map((member) => {
                const isSelected = selectedReviewerIds.includes(member.id)
                return (
                  <button
                    key={member.id}
                    onClick={() => toggleReviewer(member.id)}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left transition-colors ${
                      isSelected
                        ? 'bg-gray-200 text-gray-900'
                        : 'hover:bg-gray-100 text-gray-700'
                    }`}
                  >
                    <User className="text-gray-400 flex-shrink-0" />
                    <span className="truncate">{member.displayName}</span>
                    {isSelected && (
                      <CheckCircle
                        weight="fill"
                        className="ml-auto text-gray-600 flex-shrink-0"
                      />
                    )}
                  </button>
                )
              })}
            {internalMembers.filter((m) => m.id !== user?.id).length === 0 && (
              <p className="text-xs text-gray-400 py-2">
                選択可能なメンバーがいません
              </p>
            )}
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => {
                setShowReviewerPicker(false)
                setSelectedReviewerIds([])
              }}
              className="flex-1 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded transition-colors"
            >
              キャンセル
            </button>
            <button
              onClick={handleOpenReview}
              disabled={selectedReviewerIds.length === 0 || submitting}
              className="flex-1 px-3 py-1.5 text-xs bg-gray-900 text-white rounded hover:bg-gray-800 disabled:opacity-50 transition-colors"
            >
              {submitting ? '送信中...' : '依頼する'}
            </button>
          </div>
        </div>
      )}

      {/* Review status display */}
      {reviewData && !showReviewerPicker && (
        <div className="space-y-2">
          {/* Status badge */}
          <div className="flex items-center gap-1.5">
            {reviewData.review.status === 'approved' ? (
              <CheckCircle weight="fill" className="text-green-500 text-sm" />
            ) : reviewData.review.status === 'changes_requested' ? (
              <XCircle weight="fill" className="text-red-500 text-sm" />
            ) : (
              <Clock className="text-amber-500 text-sm" />
            )}
            <span
              className={`text-xs font-medium ${
                reviewData.review.status === 'approved'
                  ? 'text-green-700'
                  : reviewData.review.status === 'changes_requested'
                  ? 'text-red-700'
                  : 'text-amber-700'
              }`}
            >
              {reviewData.review.status === 'approved'
                ? '承認済み'
                : reviewData.review.status === 'changes_requested'
                ? '差し戻し'
                : '承認待ち'}
            </span>
          </div>

          {/* Reviewer list */}
          <div className="space-y-1">
            {reviewData.approvals.map((approval) => (
              <div
                key={approval.id}
                className="flex items-center justify-between py-1"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <User className="text-gray-400 text-xs flex-shrink-0" />
                  <span className="text-xs text-gray-700 truncate">
                    {getMemberName(approval.reviewer_id)}
                  </span>
                </div>
                <span
                  className={`px-1.5 py-0.5 text-[10px] font-medium rounded flex-shrink-0 ${
                    approval.state === 'approved'
                      ? 'bg-green-100 text-green-700'
                      : approval.state === 'blocked'
                      ? 'bg-red-100 text-red-700'
                      : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {approval.state === 'approved'
                    ? '承認'
                    : approval.state === 'blocked'
                    ? '差戻'
                    : '未対応'}
                </span>
              </div>
            ))}
          </div>

          {/* Blocked reasons */}
          {reviewData.approvals.some(
            (a) => a.state === 'blocked' && a.blocked_reason
          ) && (
            <div className="space-y-1">
              {reviewData.approvals
                .filter((a) => a.state === 'blocked' && a.blocked_reason)
                .map((a) => (
                  <div
                    key={a.id}
                    className="p-2 bg-red-50 border border-red-100 rounded text-xs"
                  >
                    <div className="flex items-center gap-1 text-red-500 mb-0.5">
                      <ChatText className="text-[10px]" />
                      <span>{getMemberName(a.reviewer_id)}</span>
                    </div>
                    <p className="text-red-700">{a.blocked_reason}</p>
                  </div>
                ))}
            </div>
          )}

          {/* Actions for current reviewer */}
          {isCurrentUserReviewer &&
            reviewData.review.status === 'open' &&
            !readOnly && (
              <div className="pt-1 space-y-2">
                {!showBlockForm ? (
                  <div className="flex gap-2">
                    <button
                      onClick={handleApprove}
                      disabled={submitting}
                      className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 transition-colors"
                    >
                      <CheckCircle weight="bold" />
                      承認
                    </button>
                    <button
                      onClick={() => setShowBlockForm(true)}
                      disabled={submitting}
                      className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 text-xs border border-red-300 text-red-600 rounded hover:bg-red-50 disabled:opacity-50 transition-colors"
                    >
                      <XCircle weight="bold" />
                      差戻
                    </button>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <textarea
                      value={blockReason}
                      onChange={(e) => setBlockReason(e.target.value)}
                      placeholder="差し戻し理由を入力..."
                      rows={2}
                      className="w-full px-2 py-1.5 text-xs border border-red-200 rounded focus:outline-none focus:ring-1 focus:ring-red-500 resize-none"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setShowBlockForm(false)
                          setBlockReason('')
                        }}
                        className="flex-1 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded transition-colors"
                      >
                        キャンセル
                      </button>
                      <button
                        onClick={handleBlock}
                        disabled={!blockReason.trim() || submitting}
                        className="flex-1 px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 transition-colors"
                      >
                        差し戻す
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
        </div>
      )}
    </div>
  )
}
