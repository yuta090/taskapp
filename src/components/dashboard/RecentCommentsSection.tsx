'use client'

import Link from 'next/link'
import { ChatCircleText } from '@phosphor-icons/react'
import { buildTaskDeepLink } from '@/lib/taskLinks'
import { formatCommentTime } from '@/lib/comments/formatCommentTime'
import type { RecentCommentRow } from '@/lib/dashboard/recentComments'

/**
 * ダッシュボードの「最近のコメント」。新しいコメントのあるタスクを1タスク1行で出し、
 * 一番新しいコメントの本文・書いた人・いつ書いたかを添える。押すとタスクの詳細が開く。
 */

export interface RecentCommentItem {
  comment: RecentCommentRow
  taskTitle: string
  authorName: string
}

function formatAbsoluteTime(dateString: string): string {
  return new Date(dateString).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function RecentCommentsSection({
  items,
  loading,
  failed,
  orgId,
  spaceId,
}: {
  items: RecentCommentItem[]
  loading: boolean
  failed: boolean
  orgId: string
  spaceId: string
}) {
  return (
    <section aria-label="最近のコメント" className="bg-surface border border-gray-200 rounded-lg p-6">
      <h3 className="text-sm font-medium text-gray-900 mb-4 flex items-center gap-1.5">
        <ChatCircleText className="text-base text-gray-500" />
        最近のコメント
      </h3>
      {loading ? (
        <p className="text-sm text-gray-400">読み込み中…</p>
      ) : failed && items.length === 0 ? (
        <p className="text-sm text-gray-400">コメントを読み込めませんでした</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-gray-400">まだコメントはありません</p>
      ) : (
        <div className="space-y-0.5">
          {items.map(({ comment, taskTitle, authorName }) => (
            <Link
              key={comment.id}
              href={buildTaskDeepLink(orgId, spaceId, comment.task_id)}
              className="block px-3 py-2 rounded-md hover:bg-gray-50 transition-colors"
            >
              <span className="flex items-center gap-2">
                <span className="flex-1 min-w-0 truncate text-sm font-medium text-gray-800">{taskTitle}</span>
                <time
                  dateTime={comment.created_at}
                  title={formatAbsoluteTime(comment.created_at)}
                  className="text-[11px] text-gray-400 flex-shrink-0"
                >
                  {formatCommentTime(comment.created_at)}
                </time>
              </span>
              <span className="mt-0.5 block text-xs text-gray-500 line-clamp-2 break-words">
                <span className="font-medium text-gray-700">{authorName}</span>
                {'：'}
                {comment.body.replace(/\s+/g, ' ').trim()}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}
