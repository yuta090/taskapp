'use client'

import { useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { getCachedUser } from '@/lib/supabase/cached-auth'

/**
 * 自分が社内承認を頼まれていて、まだ返事をしていないタスク（タスク一覧の「あなたの承認待ち」）。
 *
 * - 承認者の行（review_approvals）から、自分・保留中（pending）で、依頼（reviews）が開いている（open）ものだけを読む
 * - 組織ごとに1回だけ読み、プロジェクトの一覧とマイタスクで同じキャッシュを使う
 * - 承認・差し戻し・依頼・取り消しのあとは myPendingReviewsRootKey でまとめて取り直す
 *   （承認者が複数いると依頼は open のままなので、一覧の承認の状態だけでは印が消えない）
 */
export const myPendingReviewsRootKey = ['myPendingReviews'] as const

export function myPendingReviewsQueryKey(orgId: string | null) {
  return [...myPendingReviewsRootKey, orgId] as const
}

type PendingApprovalRow = {
  reviews: { task_id: string } | Array<{ task_id: string }> | null
}

async function fetchMyPendingReviewTaskIds(
  supabase: SupabaseClient,
  orgId: string | null
): Promise<string[]> {
  const { user, error: userError } = await getCachedUser(supabase)
  if (userError || !user) return []

  let query = supabase
    .from('review_approvals')
    .select('reviews!inner(task_id, status)')
    .eq('reviewer_id', user.id)
    .eq('state', 'pending')
    .eq('reviews.status', 'open')

  if (orgId) {
    query = query.eq('org_id', orgId)
  }

  const { data, error } = await query
  if (error) throw error

  // review_approvals から見た reviews は多対1なので、埋め込みはオブジェクトで返る。念のため配列でも読む
  const taskIds: string[] = []
  for (const row of (data ?? []) as PendingApprovalRow[]) {
    const reviews = Array.isArray(row.reviews) ? row.reviews : row.reviews ? [row.reviews] : []
    for (const review of reviews) taskIds.push(review.task_id)
  }
  return taskIds
}

const NO_TASK_IDS: ReadonlySet<string> = new Set()

export function useMyPendingReviews(
  orgId: string | null,
  options: { enabled?: boolean } = {}
): { taskIds: ReadonlySet<string> } {
  // Supabase client を useRef で安定化（遅延初期化で毎レンダー評価を回避）
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  const { data } = useQuery<string[]>({
    queryKey: myPendingReviewsQueryKey(orgId),
    queryFn: () => fetchMyPendingReviewTaskIds(supabase as SupabaseClient, orgId),
    // ほかの人が依頼してくるものなので長く据え置かない（reviews の一覧・受信トレイと同じ）
    staleTime: 30_000,
    // 一覧を開くたびに裏で取り直す。受信トレイなど別の画面で承認・差し戻ししたあとに戻ったとき、
    // 古い印を残さない（保存してあった分はすぐ出し、届いたら差し替わる）
    refetchOnMount: 'always',
    enabled: options.enabled ?? true,
  })

  const taskIds = useMemo(() => (data && data.length > 0 ? new Set(data) : NO_TASK_IDS), [data])
  return { taskIds }
}
