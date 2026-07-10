'use client'

import { useEffect, useRef } from 'react'
import { ArrowsClockwise, ChatCircleDots } from '@phosphor-icons/react'
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
  const { messages, isLoading, isRefreshing, error, refetch, sendMessage, retryMessage } = useChannelTimeline(
    orgId,
    space?.id ?? null,
    isLinked,
  )
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages.length])

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
        <button
          type="button"
          onClick={() => void refetch()}
          className="p-1.5 text-gray-400 hover:text-gray-700 rounded transition-colors"
          title="更新"
          aria-label="タイムラインを更新"
        >
          <ArrowsClockwise className={isRefreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto py-2">
        {isLoading ? (
          <LoadingState />
        ) : error ? (
          <ErrorRetry message={error} onRetry={() => void refetch()} />
        ) : messages.length === 0 ? (
          <EmptyState icon={<ChatCircleDots />} message="まだ会話がありません" />
        ) : (
          messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              onRetry={
                message.status === 'failed' ? () => void retryMessage(message) : undefined
              }
            />
          ))
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
