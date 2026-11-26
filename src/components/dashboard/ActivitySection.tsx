'use client'

import Link from 'next/link'
import { ClockCounterClockwise } from '@phosphor-icons/react'
import { formatCommentTime } from '@/lib/comments/formatCommentTime'
import type { ActivityFailureKind, ActivityView } from '@/lib/dashboard/activity'

/**
 * ダッシュボードの「最近のアクティビティ」。プロジェクトで誰が何をしたかを新しい順に出す。
 * 1行 = 誰が・何をした・対象（押すとその物が開く）・いつ。文言とリンク先は src/lib/dashboard/activity.ts。
 */

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

export function ActivitySection({
  items,
  loading,
  failure,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  items: ActivityView[]
  loading: boolean
  /** 読み込みに失敗したとき。forbidden は社内メンバー以外が開いたとき */
  failure: ActivityFailureKind | null
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
}) {
  return (
    <section aria-label="最近のアクティビティ" className="bg-surface border border-gray-200 rounded-lg p-6">
      <h3 className="text-sm font-medium text-gray-900 mb-4 flex items-center gap-1.5">
        <ClockCounterClockwise className="text-base text-gray-500" />
        最近のアクティビティ
      </h3>
      {loading ? (
        <p className="text-sm text-gray-400">読み込み中…</p>
      ) : failure === 'forbidden' ? (
        <p className="text-sm text-gray-400">最近のアクティビティは、このプロジェクトの社内メンバーだけが見られます</p>
      ) : failure && items.length === 0 ? (
        <p className="text-sm text-gray-400">アクティビティを読み込めませんでした</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-gray-400">まだアクティビティはありません</p>
      ) : (
        <>
          <ul className="space-y-0.5">
            {items.map((item) => (
              <li key={item.key} className="px-3 py-2 rounded-md hover:bg-gray-50 transition-colors">
                <div className="flex items-center gap-2">
                  <span className="flex-1 min-w-0 truncate text-sm text-gray-500">
                    <span className="font-medium text-gray-800">{item.who}</span>
                    {item.channelLabel && (
                      <span className="ml-1 px-1 py-0.5 rounded bg-gray-100 text-[10px] font-medium text-gray-500">
                        {item.channelLabel}
                      </span>
                    )}{' '}
                    {item.action}{' '}
                    {item.href ? (
                      <Link href={item.href} className="font-medium text-gray-800 hover:underline underline-offset-4">
                        {item.target}
                      </Link>
                    ) : (
                      <span className="font-medium text-gray-800">{item.target}</span>
                    )}
                  </span>
                  <time
                    dateTime={item.occurredAt}
                    title={formatAbsoluteTime(item.occurredAt)}
                    className="text-[11px] text-gray-400 flex-shrink-0"
                  >
                    {formatCommentTime(item.occurredAt)}
                  </time>
                </div>
                {item.excerpt && <p className="mt-0.5 text-xs text-gray-500 truncate">{item.excerpt}</p>}
              </li>
            ))}
          </ul>
          {failure && <p className="mt-2 px-3 text-xs text-gray-400">続きを読み込めませんでした</p>}
          {hasMore && (
            <button
              type="button"
              onClick={onLoadMore}
              disabled={loadingMore}
              className="mt-2 ml-3 px-2.5 py-1 text-xs rounded-lg border border-gray-200 hover:border-gray-300 text-gray-600 transition-colors disabled:opacity-60"
            >
              {loadingMore ? '読み込み中…' : 'もっと見る'}
            </button>
          )}
        </>
      )}
    </section>
  )
}
