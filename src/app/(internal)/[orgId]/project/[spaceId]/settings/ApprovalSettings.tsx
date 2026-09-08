'use client'

import { useCallback } from 'react'
import { toast } from 'sonner'
import { useSpaceMembers } from '@/lib/hooks/useSpaceMembers'
import { useDefaultReviewers } from '@/lib/hooks/useDefaultReviewers'

interface ApprovalSettingsProps {
  spaceId: string
}

interface ReviewerToggleProps {
  userId: string
  name: string
  checked: boolean
  onChange: (userId: string, checked: boolean) => void
}

function ReviewerToggle({ userId, name, checked, onChange }: ReviewerToggleProps) {
  return (
    <div className="flex items-center gap-3 py-2.5 px-1">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={name}
        onClick={() => onChange(userId, !checked)}
        className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
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

export function ApprovalSettings({ spaceId }: ApprovalSettingsProps) {
  const { internalMembers, loading: membersLoading } = useSpaceMembers(spaceId)
  const { defaultReviewerIds, loading, setDefaultReviewer } = useDefaultReviewers(spaceId)

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

  if (loading || membersLoading) {
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

      <div className="divide-y divide-gray-100">
        {internalMembers.map((member) => (
          <ReviewerToggle
            key={member.id}
            userId={member.id}
            name={member.displayName}
            checked={defaultReviewerIds.includes(member.id)}
            onChange={handleChange}
          />
        ))}
      </div>

      {internalMembers.length === 0 && (
        <p className="text-sm text-gray-400 py-3">社内メンバーがいません</p>
      )}
    </div>
  )
}
