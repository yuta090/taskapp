/**
 * 社内承認（レビュー）の依頼・状況の読み書き。Web の TaskReviewSection
 * （src/components/review/TaskReviewSection.tsx）と同じ表・同じ RPC を使う。
 * 見える範囲・書ける範囲は RLS と RPC が決める。
 */
import { rpc } from '@/lib/supabase/rpc'
import {
  normalizeReviewRow,
  toReviewMembers,
  type ReviewMember,
  type SpaceMemberRpcRow,
  type TaskReviewData,
} from '~/lib/reviewers'
import { supabase, typedSupabase } from './supabase'

/** そのタスクの社内承認（無ければ null）。Web の fetchReview と同じ問い合わせ */
export async function fetchTaskReview(taskId: string): Promise<TaskReviewData | null> {
  const { data, error } = await supabase
    .from('reviews')
    .select('*, review_approvals(*)')
    .eq('task_id', taskId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return normalizeReviewRow(data as Record<string, unknown>)
}

/** プロジェクトのメンバー。Web の useSpaceMembers と同じ rpc_get_space_members（FK 埋め込みを避けるための RPC） */
export async function fetchSpaceMembers(spaceId: string): Promise<ReviewMember[]> {
  const { data, error } = await supabase.rpc('rpc_get_space_members', { p_space_id: spaceId })
  if (error) throw error
  return toReviewMembers(data as SpaceMemberRpcRow[] | null)
}

/** プロジェクトの「既定の承認者」。Web の useDefaultReviewers と同じ（読むだけ。書き換えは Web で行う） */
export async function fetchDefaultReviewerIds(spaceId: string): Promise<string[]> {
  const { data, error } = await supabase.from('spaces').select('default_reviewer_ids').eq('id', spaceId).single()
  if (error) throw error
  return ((data as { default_reviewer_ids: string[] | null } | null)?.default_reviewer_ids) ?? []
}

/** 社内承認を依頼する（承認者への通知は DB 側で作られる） */
export async function openReview(taskId: string, reviewerIds: string[]) {
  return rpc.reviewOpen(typedSupabase, { taskId, reviewerIds })
}

/** 依頼を取り消す（依頼者本人か space の管理者。DB も同じ条件で確かめる） */
export async function cancelReview(reviewId: string) {
  return rpc.reviewCancel(typedSupabase, { reviewId })
}
