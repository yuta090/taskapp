'use client'

import { useState, useCallback } from 'react'
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

  const supabase = createClient()

  const fetchReviews = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      // Fetch reviews with tasks
      const { data: reviewsData, error: reviewsError } = await supabase
        .from('reviews')
        .select('*, task:tasks(*)')
        .eq('space_id' as never, spaceId as never)
        .order('created_at', { ascending: false })

      if (reviewsError) throw reviewsError

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const reviewsList = (reviewsData || []) as any[]

      // Fetch approvals for all reviews
      const reviewIds = reviewsList.map((r) => r.id)
      let approvalsByReview: Record<string, ReviewApproval[]> = {}

      if (reviewIds.length > 0) {
        const { data: approvalsData, error: approvalsError } = await supabase
          .from('review_approvals')
          .select('*')
          .in('review_id' as never, reviewIds as never)

        if (approvalsError) throw approvalsError

        approvalsByReview = {}
        const approvalsList = (approvalsData || []) as ReviewApproval[]
        approvalsList.forEach((a) => {
          if (!approvalsByReview[a.review_id]) {
            approvalsByReview[a.review_id] = []
          }
          approvalsByReview[a.review_id].push(a)
        })
      }

      // Combine data
      const reviewsWithRelations: ReviewWithRelations[] = reviewsList.map(
        (r) => ({
          ...r,
          task: r.task as Task | undefined,
          approvals: approvalsByReview[r.id] || [],
        })
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
      try {
        await rpc.reviewOpen(supabase, { taskId, reviewerIds })
        await fetchReviews()
      } catch (err) {
        throw err
      }
    },
    [supabase, fetchReviews]
  )

  const approveReview = useCallback(
    async (taskId: string) => {
      try {
        await rpc.reviewApprove(supabase, { taskId })
        await fetchReviews()
      } catch (err) {
        throw err
      }
    },
    [supabase, fetchReviews]
  )

  const blockReview = useCallback(
    async (taskId: string, reason: string) => {
      try {
        await rpc.reviewBlock(supabase, { taskId, blockedReason: reason })
        await fetchReviews()
      } catch (err) {
        throw err
      }
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
