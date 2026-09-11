'use client'

import { GitPullRequest, ArrowSquareOut } from '@phosphor-icons/react'
import { formatTimeAgo } from '@/lib/github/formatTimeAgo'

interface PRBadgeProps {
  state: 'open' | 'closed' | 'merged'
  prNumber: number
  title: string
  updatedAt: string
  additions?: number
  deletions?: number
  compact?: boolean
  /**
   * 接続した本人（または埋め込みが読める行）のときだけ渡す。PR-B: pr_url は
   * authenticated から読めない列になったため、リンクは画面側で組み立てる。
   * 未指定なら「GitHub で開く」リンク・リポジトリ名を出さず、番号・タイトル・状態・日付だけにする
   */
  repoFullName?: string
}

// 簡易的な相対時間表示（PR-B: TaskIssueList とも共有するため lib 側に切り出し済み）

export function PRBadge({
  state,
  prNumber,
  title,
  updatedAt,
  additions = 0,
  deletions = 0,
  compact = false,
  repoFullName,
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
  const prUrl = repoFullName ? `https://github.com/${repoFullName}/pull/${prNumber}` : undefined

  if (compact) {
    const content = (
      <>
        <GitPullRequest className={style.icon} weight="bold" />
        <span className="font-medium">#{prNumber}</span>
      </>
    )
    const className = `inline-flex items-center gap-1.5 px-2 py-1 text-xs rounded-full ${style.bg} ${style.border} border hover:opacity-80 transition-opacity`

    if (prUrl) {
      return (
        <a href={prUrl} target="_blank" rel="noopener noreferrer" className={className}>
          {content}
        </a>
      )
    }
    return <span className={className}>{content}</span>
  }

  const body = (
    <div className="flex items-start gap-2">
      <GitPullRequest className={`${style.icon} text-lg flex-shrink-0 mt-0.5`} weight="bold" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold ${style.icon}`}>
            #{prNumber}
          </span>
          {repoFullName && (
            <span className="text-xs text-gray-500 truncate">
              {repoFullName}
            </span>
          )}
          {prUrl && (
            <ArrowSquareOut className="text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity text-xs" />
          )}
        </div>
        <p className="text-sm text-gray-800 font-medium truncate mt-0.5">
          {title}
        </p>
        <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
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
  )

  if (prUrl) {
    return (
      <a
        href={prUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={`block p-3 rounded-lg border ${style.bg} ${style.border} hover:opacity-90 transition-opacity group`}
      >
        {body}
      </a>
    )
  }

  return (
    <div className={`p-3 rounded-lg border ${style.bg} ${style.border}`}>
      {body}
    </div>
  )
}
