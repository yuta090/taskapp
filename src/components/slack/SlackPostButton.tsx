'use client'

import { useState } from 'react'
import { ChatCircleDots, PaperPlaneTilt } from '@phosphor-icons/react'
import { usePostToSlack, useSlackChannel } from '@/lib/hooks/useSlack'
import { isSlackConfigured } from '@/lib/slack/config'

interface SlackPostButtonProps {
  taskId: string
  spaceId: string
}

export function SlackPostButton({ taskId, spaceId }: SlackPostButtonProps) {
  const [showInput, setShowInput] = useState(false)
  const [message, setMessage] = useState('')
  const [success, setSuccess] = useState(false)

  const { data: channel } = useSlackChannel(spaceId)
  const postToSlack = usePostToSlack()

  // Slack未設定またはチャンネル未紐付けの場合は非表示
  if (!isSlackConfigured() || !channel) return null

  const handlePost = async () => {
    try {
      await postToSlack.mutateAsync({
        taskId,
        spaceId,
        customMessage: message || undefined,
      })

      setSuccess(true)
      setMessage('')
      setShowInput(false)
      setTimeout(() => setSuccess(false), 3000)
    } catch (err) {
      console.error('Failed to post to Slack:', err)
      alert('Slackへの投稿に失敗しました')
    }
  }

  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-gray-500 flex items-center gap-1">
        <ChatCircleDots className="text-sm" />
        Slack
        <span className="text-gray-400">#{channel.channel_name}</span>
      </label>

      {showInput ? (
        <div className="space-y-2 p-3 bg-gray-50 rounded-lg">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="メッセージを追加（任意）"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            rows={2}
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => { setShowInput(false); setMessage('') }}
              className="px-2 py-1 text-xs text-gray-600 hover:bg-gray-200 rounded"
            >
              キャンセル
            </button>
            <button
              onClick={handlePost}
              disabled={postToSlack.isPending}
              data-testid="slack-post-confirm"
              className="flex items-center gap-1 px-3 py-1 text-xs text-white bg-[#4A154B] hover:bg-[#611f64] disabled:bg-gray-300 rounded transition-colors"
            >
              <PaperPlaneTilt className="text-sm" />
              {postToSlack.isPending ? '送信中...' : 'Slackに投稿'}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowInput(true)}
          data-testid="slack-post-button"
          className={`w-full px-3 py-2 text-sm rounded-lg border transition-colors ${
            success
              ? 'bg-green-50 border-green-200 text-green-700'
              : 'border-gray-200 hover:bg-gray-50 text-gray-700'
          }`}
        >
          {success ? '投稿しました' : 'Slackに投稿'}
        </button>
      )}
    </div>
  )
}
