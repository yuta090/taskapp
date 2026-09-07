'use client'

import { usePendingGroupClaims } from '@/lib/hooks/usePendingGroupClaims'

interface Props {
  orgId: string
  channel: string
}

function formatReceivedAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/**
 * チャネルごとの「確認待ち」— 合言葉が投稿されたチャンネルを、その場で承認/却下する。
 *
 * これまで承認は LINE 用ページにしか無く、Slack の合言葉を投稿しても Slack の画面には
 * 何も出なかった。合言葉の発行(SharedBotClaimPanel)のすぐ下に置き、発行→投稿→承認が
 * 同じ画面で完結するようにする。
 */
export function PendingClaimsPanel({ orgId, channel }: Props) {
  const { items, isLoading, error, act, busy, rowErrors } = usePendingGroupClaims(orgId, channel)

  return (
    <section className="mt-6" data-testid="pending-claims-panel">
      <h2 className="text-sm font-semibold text-gray-700 mb-1">チャンネルの承認</h2>
      <p className="text-xs text-gray-500 mb-3">
        合言葉が投稿されたチャンネルがここに出ます。承認すると、そのチャンネルの会話を秘書が読み始めます。
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!error && isLoading && <p className="text-xs text-gray-400">読み込み中…</p>}
      {!error && !isLoading && items.length === 0 && (
        <p className="text-sm text-gray-500">承認待ちのチャンネルはまだありません。</p>
      )}

      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((it) => {
            const rowBusy = busy[it.id]
            return (
              <li
                key={it.id}
                className="rounded border border-amber-200 bg-amber-50 px-3 py-2"
                data-testid={`pending-claim-${it.id}`}
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="text-xs text-gray-500">確認番号</span>
                  <code className="rounded bg-surface px-1.5 py-0.5 text-sm font-semibold tracking-wider text-gray-900">
                    {it.challengeLabel ?? '—'}
                  </code>
                  <span className="text-xs text-gray-500">相手先</span>
                  <span className="text-gray-900">{it.spaceName ?? '（不明）'}</span>
                  {it.groupDisplayNameSnapshot && (
                    <>
                      <span className="text-xs text-gray-500">チャンネル</span>
                      <span className="text-gray-900">{it.groupDisplayNameSnapshot}</span>
                    </>
                  )}
                  <span className="ml-auto text-xs text-gray-400">{formatReceivedAt(it.createdAt)} 受付</span>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    disabled={!!rowBusy}
                    onClick={() => void act(it.id, 'approve')}
                    className="inline-flex items-center rounded bg-amber-500 px-3 py-1 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-50"
                  >
                    承認
                  </button>
                  <button
                    type="button"
                    disabled={!!rowBusy}
                    onClick={() => void act(it.id, 'reject')}
                    className="inline-flex items-center rounded border border-gray-200 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                  >
                    却下
                  </button>
                  {rowErrors[it.id] && <span className="text-xs text-red-600">{rowErrors[it.id]}</span>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
