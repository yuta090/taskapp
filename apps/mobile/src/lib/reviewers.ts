/**
 * 社内承認（レビュー）の依頼・状況表示の決まり。Web の TaskReviewSection
 * （src/components/review/TaskReviewSection.tsx）と同じ条件・同じ文言を、画面から切り離して持つ。
 * React・通信は使わない（テストできる形にするため）。
 */
import { resolveDefaultReviewerIds } from '@/lib/review/defaultReviewers'
import { isReviewApproverRole } from '@/lib/roles/spaceRoles'

/** rpc_get_space_members の1行を画面用にしたもの（Web の useSpaceMembers と同じ形の一部） */
export interface ReviewMember {
  id: string
  displayName: string
  role: string
}

export interface ReviewSummary {
  id: string
  status: string
  created_by: string
}

export interface ReviewApprovalRow {
  id: string
  reviewer_id: string
  state: string
  blocked_reason: string | null
}

export interface TaskReviewData {
  review: ReviewSummary
  approvals: ReviewApprovalRow[]
}

/**
 * 承認者に選べる人。自分は自分の承認者にできないので外し、admin / editor だけを残す
 * （rpc_review_open が受け付ける範囲。viewer を選ぶと依頼が失敗する）。
 */
export function selectableReviewers(members: readonly ReviewMember[], myUserId: string | null): ReviewMember[] {
  return members.filter((m) => m.id !== myUserId && isReviewApproverRole(m.role))
}

/** space の管理者か（Web は role === 'admin' で見ている） */
export function isSpaceAdminMember(members: readonly ReviewMember[], myUserId: string | null): boolean {
  if (!myUserId) return false
  return members.some((m) => m.id === myUserId && m.role === 'admin')
}

/** 承認者の名前。メンバーに見つからなければ id の先頭8文字 */
export function memberDisplayName(members: readonly ReviewMember[], userId: string): string {
  return members.find((m) => m.id === userId)?.displayName || userId.slice(0, 8)
}

export function reviewStatusLabel(status: string): string {
  if (status === 'approved') return '社内承認済み'
  if (status === 'changes_requested') return '差し戻し'
  return '社内承認待ち'
}

export function approvalStateLabel(state: string): string {
  if (state === 'approved') return '承認'
  if (state === 'blocked') return '差し戻し'
  return '未対応'
}

/**
 * 依頼ボタンの出し分け。依頼が無い・取り消し済みは「依頼」、承認済み・差し戻しは「再依頼」、
 * 承認待ち（open）は依頼できない（null）。
 */
export function reviewRequestMode(review: Pick<ReviewSummary, 'status'> | null): 'request' | 'rerequest' | null {
  if (!review || review.status === 'cancelled') return 'request'
  if (review.status === 'open') return null
  return 'rerequest'
}

/** 取り消せるか。依頼がまだ生きていて（open / 差し戻し）、依頼者本人か space の管理者のとき（Web と同じ） */
export function canCancelReview(
  review: Pick<ReviewSummary, 'status' | 'created_by'> | null,
  myUserId: string | null,
  isSpaceAdmin: boolean
): boolean {
  if (!review) return false
  if (review.status !== 'open' && review.status !== 'changes_requested') return false
  return (!!myUserId && review.created_by === myUserId) || isSpaceAdmin
}

/**
 * 選んでいる承認者。まだ触っていない（null）あいだはプロジェクトの既定をそのまま映す。
 * 再依頼で入れた前回の承認者などが、スペースを抜けた・viewer に下がった場合に備え、
 * 毎回「いま選べる人」と突き合わせて落とす（見えないまま選ばれて依頼だけ失敗するのを防ぐ）。
 */
export function resolveSelection(
  selected: readonly string[] | null,
  defaultReviewerIds: readonly string[] | null | undefined,
  selectableIds: readonly string[]
): string[] {
  return resolveDefaultReviewerIds(selected ?? defaultReviewerIds, selectableIds)
}

/** 選択の付け外し。元の配列は書き換えない */
export function toggleReviewer(selected: readonly string[], userId: string): string[] {
  return selected.includes(userId) ? selected.filter((id) => id !== userId) : [...selected, userId]
}

/** `reviews` + `review_approvals(*)` の1行を、画面が使う形にする（使う列だけ残す） */
export function normalizeReviewRow(row: Record<string, unknown>): TaskReviewData {
  const approvalsRaw = Array.isArray(row.review_approvals) ? (row.review_approvals as Record<string, unknown>[]) : []
  return {
    review: {
      id: row.id as string,
      status: row.status as string,
      created_by: row.created_by as string,
    },
    approvals: approvalsRaw.map((a) => ({
      id: a.id as string,
      reviewer_id: a.reviewer_id as string,
      state: a.state as string,
      blocked_reason: (a.blocked_reason as string | null) ?? null,
    })),
  }
}

/** rpc_get_space_members の1行（Web の useSpaceMembers と同じ読み方） */
export interface SpaceMemberRpcRow {
  user_id: string
  display_name: string | null
  role: string
}

export function toReviewMembers(rows: readonly SpaceMemberRpcRow[] | null): ReviewMember[] {
  return (rows ?? []).map((m) => ({
    id: m.user_id,
    displayName: m.display_name || m.user_id.slice(0, 8) + '...',
    role: m.role,
  }))
}

/**
 * 依頼した直後に先に画面へ出す「社内承認」の形。サーバー（_review_open_impl）は再依頼のとき、
 * 承認済みの人の状態をそのまま残し、それ以外は未対応に戻す。全員が承認済みなら最初から approved になる。
 * id はサーバーが決めるので、まだ無い（空）。
 */
export function optimisticOpenedReview(
  previous: TaskReviewData | null | undefined,
  reviewerIds: readonly string[],
  myUserId: string
): TaskReviewData {
  const kept = previous && previous.review.status !== 'cancelled' ? previous.approvals : []
  const approvals: ReviewApprovalRow[] = reviewerIds.map((reviewerId) => {
    const before = kept.find((a) => a.reviewer_id === reviewerId)
    return before?.state === 'approved'
      ? before
      : { id: `pending-${reviewerId}`, reviewer_id: reviewerId, state: 'pending', blocked_reason: null }
  })
  const allApproved = approvals.length > 0 && approvals.every((a) => a.state === 'approved')
  return { review: { id: '', status: allApproved ? 'approved' : 'open', created_by: myUserId }, approvals }
}
