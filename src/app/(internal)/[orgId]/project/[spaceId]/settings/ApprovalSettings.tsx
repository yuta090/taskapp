'use client'

import { useCallback, useMemo } from 'react'
import { toast } from 'sonner'
import { useSpaceMembers } from '@/lib/hooks/useSpaceMembers'
import { useDefaultReviewers } from '@/lib/hooks/useDefaultReviewers'
import { useCanEditSpace } from '@/lib/hooks/useCanEditSpace'
import { isReviewApproverRole } from '@/lib/roles/spaceRoles'

interface ApprovalSettingsProps {
  orgId: string
  spaceId: string
}

interface ReviewerToggleProps {
  userId: string
  name: string
  checked: boolean
  onChange: (userId: string, checked: boolean) => void
  disabled?: boolean
}

function ReviewerToggle({ userId, name, checked, onChange, disabled = false }: ReviewerToggleProps) {
  return (
    <div className="flex items-center gap-3 py-2.5 px-1">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={name}
        disabled={disabled}
        onClick={() => onChange(userId, !checked)}
        className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
          checked ? 'bg-indigo-600' : 'bg-gray-200'
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-surface shadow transition-transform ${
            checked ? 'translate-x-[18px]' : 'translate-x-[3px]'
          }`}
        />
      </button>
      <span className="text-sm text-gray-900 truncate">{name}</span>
    </div>
  )
}

export function ApprovalSettings({ orgId, spaceId }: ApprovalSettingsProps) {
  const { internalMembers, isPending: membersPending } = useSpaceMembers(spaceId)
  // 承認者候補は、社内メンバーの中でも admin/editor だけ（rpc_review_openが受け付ける範囲）。
  // 閲覧者(viewer)を選べてしまうと、承認依頼のその場でDBに断られる
  const approverCandidates = useMemo(
    () => internalMembers.filter((m) => isReviewApproverRole(m.role)),
    [internalMembers]
  )
  const { defaultReviewerIds, loading, setDefaultReviewer } = useDefaultReviewers(spaceId)
  // 既定の承認者(spaces.default_reviewer_ids)の更新は spaces の更新（RLS: app_can_write_space）
  // と同じ規則。役割が未確定の間も canEdit は false（読み取り専用側に倒す）
  const { canEdit } = useCanEditSpace(spaceId, orgId)

  const handleChange = useCallback(
    async (userId: string, checked: boolean) => {
      try {
        await setDefaultReviewer(userId, checked)
      } catch {
        toast.error('既定の承認者を保存できませんでした')
      }
    },
    [setDefaultReviewer]
  )

  // 既定に選んだあとで viewer に下げられた・スペースを抜けた等で、候補外になった
  // IDが spaces.default_reviewer_ids に残ることがある。ここに並ばず外せないままだと
  // 気づけないので、見つけたら外すよう促す（TaskReviewSection側は
  // resolveDefaultReviewerIdsで無視しているだけで、DBの値自体は残ったまま）
  const staleDefaultIds = useMemo(
    () => defaultReviewerIds.filter((id) => !approverCandidates.some((m) => m.id === id)),
    [defaultReviewerIds, approverCandidates]
  )
  const staleDefaultNames = useMemo(
    () =>
      staleDefaultIds.map(
        (id) => internalMembers.find((m) => m.id === id)?.displayName ?? '退出済みのメンバー'
      ),
    [staleDefaultIds, internalMembers]
  )
  const handleRemoveStale = useCallback(async () => {
    try {
      await Promise.all(staleDefaultIds.map((id) => setDefaultReviewer(id, false)))
    } catch {
      toast.error('既定の承認者を保存できませんでした')
    }
  }, [staleDefaultIds, setDefaultReviewer])

  if (loading || membersPending) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-4 bg-gray-100 rounded w-1/3" />
        <div className="h-10 bg-gray-50 rounded" />
        <div className="h-10 bg-gray-50 rounded" />
      </div>
    )
  }

  return (
    <div>
      <h3 className="text-base font-semibold text-gray-900 mb-1">社内承認</h3>
      <p className="text-xs text-gray-500 mb-4">
        ここで選んだ人は、タスクで社内承認を依頼するときに最初から選ばれた状態になります。
        依頼するその場で足したり外したりできます。
      </p>

      {canEdit && staleDefaultIds.length > 0 && (
        <div className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-xs text-amber-800">
            候補外の人（{staleDefaultNames.join('・')}）が既定に残っています
          </p>
          <button
            type="button"
            onClick={handleRemoveStale}
            className="shrink-0 text-xs font-medium text-amber-800 underline hover:no-underline"
          >
            外す
          </button>
        </div>
      )}

      <div className="divide-y divide-gray-100">
        {approverCandidates.map((member) => (
          <ReviewerToggle
            key={member.id}
            userId={member.id}
            name={member.displayName}
            checked={defaultReviewerIds.includes(member.id)}
            onChange={handleChange}
            disabled={!canEdit}
          />
        ))}
      </div>

      {approverCandidates.length === 0 && (
        <p className="text-sm text-gray-400 py-3">社内メンバーがいません</p>
      )}
    </div>
  )
}
