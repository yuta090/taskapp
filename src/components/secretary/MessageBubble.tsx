'use client'

import {
  Image as ImageIcon,
  FileText,
  VideoCamera,
  SpeakerHigh,
  Sticker,
  Warning,
  SpinnerGap,
} from '@phosphor-icons/react'
import type { ChannelMessageRow } from '@/lib/hooks/useChannelTimeline'
import { channelBadgeLabel } from '@/lib/channels/channelBadge'
import { ChannelIcon } from '@/components/secretary/ChannelIcon'

const ACTOR_LABEL: Record<ChannelMessageRow['actor'], string> = {
  client: '顧問先',
  secretary: '秘書',
  staff: '担当者',
  system: 'システム',
}

function attachmentIcon(contentType: string) {
  switch (contentType) {
    case 'image':
      return <ImageIcon />
    case 'video':
      return <VideoCamera />
    case 'audio':
      return <SpeakerHigh />
    case 'sticker':
      return <Sticker />
    default:
      return <FileText />
  }
}

const ATTACHMENT_TYPE_LABEL: Record<string, string> = {
  image: '画像',
  file: 'ファイル',
  video: '動画',
  audio: '音声',
  sticker: 'スタンプ',
}

function attachmentLabel(message: ChannelMessageRow): string {
  const typeLabel = ATTACHMENT_TYPE_LABEL[message.content_type] ?? 'ファイル'
  const fileName = message.storage_path?.split('/').pop()
  return fileName ? `${typeLabel}: ${fileName}` : typeLabel
}

interface MessageBubbleProps {
  message: ChannelMessageRow
  /** status='failed' のときのみ渡す。同一テキストで再送する */
  onRetry?: () => void
}

/**
 * 会話タイムラインの1メッセージ。inbound=左、outbound=右。
 * redacted(機微情報の中身破壊)は墓標表示にする(CHANNEL_PLUMBING_SPEC.md §3)。
 */
export function MessageBubble({ message, onRetry }: MessageBubbleProps) {
  const isOutbound = message.direction === 'outbound'
  const time = new Date(message.occurred_at).toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
  })
  // どのチャット（LINE/Discord等）由来かのバッジ。未知チャネルは null＝非表示。
  const badge = channelBadgeLabel(message.channel)

  if (message.redacted_at) {
    return (
      <div className={`flex ${isOutbound ? 'justify-end' : 'justify-start'} px-3 py-1`}>
        <div className="max-w-[70%] px-3 py-2 rounded-xl bg-gray-50 border border-dashed border-gray-300 text-gray-400 text-xs italic">
          削除済み（機微情報）
        </div>
      </div>
    )
  }

  return (
    <div className={`flex ${isOutbound ? 'justify-end' : 'justify-start'} px-3 py-1`}>
      <div className={`max-w-[70%] flex flex-col gap-0.5 ${isOutbound ? 'items-end' : 'items-start'}`}>
        <div
          className={`px-3 py-2 rounded-xl text-sm whitespace-pre-wrap break-words ${
            isOutbound
              ? 'bg-indigo-600 text-white rounded-br-sm'
              : 'bg-gray-100 text-gray-900 rounded-bl-sm'
          } ${message.status === 'failed' ? 'opacity-60' : ''}`}
        >
          {message.content_type === 'text' ? (
            message.body
          ) : (
            <span className="flex items-center gap-1.5">
              {attachmentIcon(message.content_type)}
              {attachmentLabel(message)}
            </span>
          )}
        </div>
        <div
          className={`flex items-center gap-1.5 text-[10px] text-gray-400 ${
            isOutbound ? 'flex-row-reverse' : ''
          }`}
        >
          {badge && (
            <span className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-500">
              <ChannelIcon channel={message.channel} />
              {badge}
            </span>
          )}
          <span>{ACTOR_LABEL[message.actor] ?? message.actor}</span>
          <span>{time}</span>
          {message.status === 'queued' && <SpinnerGap className="animate-spin" />}
          {message.status === 'failed' && (
            <button
              type="button"
              onClick={onRetry}
              className="flex items-center gap-0.5 text-red-500 hover:text-red-700 transition-colors"
              title={message.error ?? '送信に失敗しました'}
            >
              <Warning />
              {onRetry && <span className="underline">再試行</span>}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
