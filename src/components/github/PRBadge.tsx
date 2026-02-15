'use client'

import { GitPullRequest, ArrowSquareOut } from '@phosphor-icons/react'

interface PRBadgeProps {
  state: 'open' | 'closed' | 'merged'
  prNumber: number
  prUrl: string
  title: string
  repoName: string
  authorLogin?: string
  additions?: number
  deletions?: number
  updatedAt: string
  compact?: boolean
}

// 簡易的な相対時間表示
function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSecs = Math.floor(diffMs / 1000)
  const diffMins = Math.floor(diffSecs / 60)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffDays > 0) {
    return `${diffDays}日前`
  } else if (diffHours > 0) {
    return `${diffHours}時間前`
  } else if (diffMins > 0) {
    return `${diffMins}分前`
  } else {
    return 'たった今'
  }
}

export function PRBadge({
  state,
  prNumber,
  prUrl,
  title,
  repoName,
  authorLogin,
  additions = 0,
  deletions = 0,
  updatedAt,
  compact = false,
}: PRBadgeProps) {
  const stateStyles = {
    open: {
      bg: 'bg-green-50',
      border: 'border-green-200',
      icon: 'text-green-600',
      label: 'Open',
    },
    closed: {
      bg: 'bg-red-50',
      border: 'border-red-200',
      icon: 'text-red-600',
      label: 'Closed',
    },
    merged: {
      bg: 'bg-gray-50',
      border: 'border-gray-200',
      icon: 'text-gray-600',
      label: 'Merged',
    },
  }

  const style = stateStyles[state]
  const timeAgo = formatTimeAgo(updatedAt)

  if (compact) {
    return (
      <a
        href={prUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={`inline-flex items-center gap-1.5 px-2 py-1 text-xs rounded-full ${style.bg} ${style.border} border hover:opacity-80 transition-opacity`}
      >
        <GitPullRequest className={style.icon} weight="bold" />
        <span className="font-medium">#{prNumber}</span>
      </a>
    )
  }

  return (
    <a
      href={prUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={`block p-3 rounded-lg border ${style.bg} ${style.border} hover:opacity-90 transition-opacity group`}
    >
      <div className="flex items-start gap-2">
        <GitPullRequest className={`${style.icon} text-lg flex-shrink-0 mt-0.5`} weight="bold" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-semibold ${style.icon}`}>
              #{prNumber}
            </span>
            <span className="text-xs text-gray-500 truncate">
              {repoName}
            </span>
            <ArrowSquareOut className="text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity text-xs" />
          </div>
          <p className="text-sm text-gray-800 font-medium truncate mt-0.5">
            {title}
          </p>
          <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
            {authorLogin && (
              <span>by {authorLogin}</span>
            )}
            <span>{timeAgo}</span>
            {(additions > 0 || deletions > 0) && (
              <span>
                <span className="text-green-600">+{additions}</span>
                {' / '}
                <span className="text-red-600">-{deletions}</span>
              </span>
            )}
          </div>
        </div>
      </div>
    </a>
  )
}
