'use client'

import { useCallback, useLayoutEffect, useRef } from 'react'
import { ArrowsClockwise, ArrowLineDown, ChatCircleDots } from '@phosphor-icons/react'
import { EmptyState, ErrorRetry, LoadingState } from '@/components/shared'
import { useChannelTimeline } from '@/lib/hooks/useChannelTimeline'
import { MessageBubble } from './MessageBubble'
import { MessageComposer } from './MessageComposer'
import type { UserSpace } from '@/lib/hooks/useUserSpaces'

interface MessageTimelineProps {
  orgId: string
  space: UserSpace | null
  isLinked: boolean
}

/** 右カラム: 選択spaceの会話タイムライン＋送信ボックス */
export function MessageTimeline({ orgId, space, isLinked }: MessageTimelineProps) {
  const {
    messages,
    isLoading,
    isRefreshing,
    error,
    refetch,
    refreshLatest,
    sendMessage,
    retryMessage,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useChannelTimeline(orgId, space?.id ?? null, isLinked)
  const scrollRef = useRef<HTMLDivElement>(null)
  /** true の間は直後の messages.length 変化を「履歴読み込み」由来とみなし、最下部追従をスキップする */
  const isLoadingOlderRef = useRef(false)
  /** 履歴読み込み直前のscrollHeight。コミット後(レイアウト確定後)にこの差分だけscrollTopをずらす */
  const prevScrollHeightRef = useRef<number | null>(null)

  // コミット後・ペイント前に同期実行することで、1フレームの「ジャンプ」が見えないようにする
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return

    if (isLoadingOlderRef.current && prevScrollHeightRef.current !== null) {
      // 履歴prepend分だけ増えた高さをそのままscrollTopに加算し、表示位置を保つ(先頭へ飛ばさない)
      el.scrollTop += el.scrollHeight - prevScrollHeightRef.current
      isLoadingOlderRef.current = false
      prevScrollHeightRef.current = null
      return
    }

    // 新規受信/送信時のみ最下部へ追従する
    el.scrollTop = el.scrollHeight
  }, [messages.length])

  const handleLoadOlder = useCallback(() => {
    isLoadingOlderRef.current = true
    prevScrollHeightRef.current = scrollRef.current?.scrollHeight ?? 0
    void fetchNextPage()
  }, [fetchNextPage])

  const handleGoToLatest = useCallback(() => {
    isLoadingOlderRef.current = false
    prevScrollHeightRef.current = null
    void refreshLatest()
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [refreshLatest])

  if (!space) {
    return (
      <div className="flex-1 min-w-0 flex flex-col">
        <EmptyState icon={<ChatCircleDots />} message="左のリストから連携先を選択してください" />
      </div>
    )
  }

  return (
    <div className="flex-1 min-w-0 min-h-0 flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 flex-shrink-0">
        <h2 className="text-sm font-medium text-gray-900 truncate">{space.name}</h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleGoToLatest}
            className="flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:text-gray-800 rounded transition-colors"
            title="最新のメッセージへ戻る"
          >
            <ArrowLineDown />
            最新へ
          </button>
          <button
            type="button"
            onClick={() => void refreshLatest()}
            className="p-1.5 text-gray-400 hover:text-gray-700 rounded transition-colors"
            title="更新"
            aria-label="タイムラインを更新"
          >
            <ArrowsClockwise className={isRefreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto py-2">
        {isLoading ? (
          <LoadingState />
        ) : error ? (
          <ErrorRetry message={error} onRetry={() => void refetch()} />
        ) : messages.length === 0 ? (
          <EmptyState icon={<ChatCircleDots />} message="まだ会話がありません" />
        ) : (
          <>
            {hasNextPage && (
              <div className="flex justify-center py-2">
                <button
                  type="button"
                  onClick={handleLoadOlder}
                  disabled={isFetchingNextPage}
                  className="text-xs text-gray-500 hover:text-gray-800 underline disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isFetchingNextPage ? '読み込み中...' : '以前のメッセージを読み込む'}
                </button>
              </div>
            )}
            {messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                onRetry={
                  message.status === 'failed' ? () => void retryMessage(message) : undefined
                }
              />
            ))}
          </>
        )}
      </div>

      <MessageComposer
        targetLabel={space.name}
        disabled={!isLinked}
        disabledReason="確認コードで連携してください"
        onSend={sendMessage}
      />
    </div>
  )
}
