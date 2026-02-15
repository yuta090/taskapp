'use client'

import { useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { rpc } from '@/lib/supabase/rpc'
import type { Review, ReviewApproval, Task } from '@/types/database'

interface UseReviewsOptions {
  spaceId: string
}

interface ReviewWithRelations extends Review {
  task?: Task
  approvals?: ReviewApproval[]
}

interface UseReviewsReturn {
  reviews: ReviewWithRelations[]
  loading: boolean
  error: Error | null
  fetchReviews: () => Promise<void>
  openReview: (taskId: string, reviewerIds: string[]) => Promise<void>
  approveReview: (taskId: string) => Promise<void>
  blockReview: (taskId: string, reason: string) => Promise<void>
}

export function useReviews({ spaceId }: UseReviewsOptions): UseReviewsReturn {
  const [reviews, setReviews] = useState<ReviewWithRelations[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (!supabaseRef.current) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  const fetchReviews = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      // 1クエリで reviews + tasks + approvals を取得（ネストselect）
      const { data: reviewsData, error: reviewsError } = await supabase
        .from('reviews')
        .select('*, task:tasks(*), review_approvals(*)')
        .eq('space_id' as never, spaceId as never)
        .order('created_at', { ascending: false })
        .limit(50)

      if (reviewsError) throw reviewsError

      const rawReviews = (reviewsData || []) as Array<Record<string, unknown>>

      // review_approvals をパースし、reviews からは除去
      const reviewsWithRelations: ReviewWithRelations[] = rawReviews.map(
        (r) => {
          const { review_approvals, task, ...reviewFields } = r
          return {
            ...(reviewFields as unknown as Review),
            task: task as Task | undefined,
            approvals: (Array.isArray(review_approvals) ? review_approvals : []) as ReviewApproval[],
          }
        }
      )

      setReviews(reviewsWithRelations)
    } catch (err) {
      setError(
        err instanceof Error ? err : new Error('Failed to fetch reviews')
      )
    } finally {
      setLoading(false)
    }
  }, [spaceId, supabase])

  const openReview = useCallback(
    async (taskId: string, reviewerIds: string[]) => {
      await rpc.reviewOpen(supabase, { taskId, reviewerIds })
      // バックグラウンドで最新データを反映
      void fetchReviews()
    },
    [supabase, fetchReviews]
  )

  const approveReview = useCallback(
    async (taskId: string) => {
      await rpc.reviewApprove(supabase, { taskId })
      void fetchReviews()
    },
    [supabase, fetchReviews]
  )

  const blockReview = useCallback(
    async (taskId: string, reason: string) => {
      await rpc.reviewBlock(supabase, { taskId, blockedReason: reason })
      void fetchReviews()
    },
    [supabase, fetchReviews]
  )

  return {
    reviews,
    loading,
    error,
    fetchReviews,
    openReview,
    approveReview,
    blockReview,
  }
}
