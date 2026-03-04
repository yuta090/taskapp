'use client'

import { useState } from 'react'
import {
  ChatCircleDots,
  Trash,
  CheckCircle,
  Link as LinkIcon,
  ArrowRight,
} from '@phosphor-icons/react'
import {
  useSlackWorkspace,
  useSlackChannel,
  useSlackChannelList,
  useLinkSlackChannel,
  useUnlinkSlackChannel,
  useUpdateNotifyToggles,
} from '@/lib/hooks/useSlack'
import { isSlackConfigured } from '@/lib/slack/config'
import { toast } from 'sonner'
import { useConfirmDialog } from '@/components/shared'
import Link from 'next/link'

interface SlackChannelSettingsProps {
  orgId: string
  spaceId: string
}

export function SlackChannelSettings({ orgId, spaceId }: SlackChannelSettingsProps) {
  const { confirm, ConfirmDialog } = useConfirmDialog()
  const [selectedChannelId, setSelectedChannelId] = useState('')

  const { data: workspace, isLoading: loadingWorkspace } = useSlackWorkspace(orgId)
  const { data: linkedChannel, isLoading: loadingLinked } = useSlackChannel(spaceId)
  const { data: channels = [], isLoading: loadingChannels } = useSlackChannelList(orgId)
  const linkChannel = useLinkSlackChannel()
  const unlinkChannel = useUnlinkSlackChannel()
  const updateToggles = useUpdateNotifyToggles()

  const isConfigured = isSlackConfigured()

  const handleLink = async () => {
    if (!selectedChannelId) return
    const channel = channels.find(c => c.id === selectedChannelId)
    if (!channel) return
    try {
      await linkChannel.mutateAsync({
        spaceId,
        channelId: channel.id,
        channelName: channel.name,
      })
      setSelectedChannelId('')
      toast.success(`#${channel.name} を連携しました`)
    } catch {
      toast.error('チャンネルの連携に失敗しました')
    }
  }

  const handleUnlink = async () => {
    const ok = await confirm({
      title: 'チャンネル連携を解除',
      message: 'このSlackチャンネルの連携を解除しますか？',
      confirmLabel: '解除',
      variant: 'danger',
    })
    if (!ok) return
    try {
      await unlinkChannel.mutateAsync(spaceId)
      toast.success('チャンネル連携を解除しました')
    } catch {
      toast.error('連携の解除に失敗しました')
    }
  }

  if (!isConfigured) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-gray-700">
          <ChatCircleDots className="text-lg" weight="bold" />
          <h3 className="font-medium">Slack連携</h3>
        </div>
        <div className="bg-gray-50 rounded-lg p-4">
          <p className="text-sm text-gray-600">
            Slack連携は現在無効です。管理者に連絡してください。
          </p>
        </div>
      </div>
    )
  }

  const isLoading = loadingWorkspace || loadingLinked || loadingChannels

  return (
    <div className="space-y-4">
      {ConfirmDialog}
      <div className="flex items-center gap-2 text-gray-700">
        <ChatCircleDots className="text-lg" weight="bold" />
        <h3 className="font-medium">Slack連携</h3>
      </div>

      {isLoading ? (
        <div className="p-4 text-sm text-gray-500">読み込み中...</div>
      ) : !workspace ? (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-3">
          <p className="text-sm text-amber-800">
            Slackワークスペースが組織に連携されていません。
          </p>
          <Link
            href="/settings/org-integrations"
            className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
          >
            組織設定で連携する
            <ArrowRight className="text-xs" />
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {/* ワークスペース情報 (簡潔) */}
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle className="text-green-500" weight="fill" />
            <span className="text-gray-600">
              <strong>{workspace.team_name}</strong> と連携中
            </span>
          </div>

          {/* チャンネル紐付け */}
          {linkedChannel ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle className="text-green-500" weight="fill" />
                <span className="text-gray-600">
                  <strong>#{linkedChannel.channel_name}</strong> にチャンネル連携中
                </span>
                <button
                  onClick={handleUnlink}
                  disabled={unlinkChannel.isPending}
                  className="ml-2 p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                  title="チャンネル連携を解除"
                >
                  <Trash className="text-sm" />
                </button>
              </div>

              {/* 自動通知トグル */}
              <div className="border border-gray-200 rounded-lg p-4 space-y-3">
                <h4 className="text-sm font-medium text-gray-700">自動通知設定</h4>
                <p className="text-xs text-gray-500">
                  有効にしたイベントが発生するとSlackに自動通知されます。
                </p>
                {[
                  { key: 'notify_task_created' as const, label: 'タスク作成時' },
                  { key: 'notify_ball_passed' as const, label: 'ボール移動時' },
                  { key: 'notify_status_changed' as const, label: 'ステータス変更時' },
                  { key: 'notify_comment_added' as const, label: 'コメント追加時' },
                ].map(({ key, label }) => (
                  <label key={key} className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={linkedChannel?.[key] ?? (key !== 'notify_comment_added')}
                      onChange={(e) => {
                        updateToggles.mutate({
                          spaceId,
                          toggles: { [key]: e.target.checked },
                        })
                      }}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700">{label}</span>
                  </label>
                ))}
              </div>

              <div className="bg-gray-50 rounded-lg p-4 text-sm">
                <h4 className="font-medium text-gray-700 mb-2">
                  <LinkIcon className="inline mr-1" />
                  手動投稿
                </h4>
                <p className="text-gray-600">
                  タスク詳細画面の「Slackに投稿」ボタンからタスク情報をSlackに共有できます。
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-gray-600">
                通知先のSlackチャンネルを選択してください。
              </p>
              <div className="border border-gray-200 rounded-lg p-4">
                <div className="text-xs font-medium text-gray-500 mb-2">
                  チャンネルを選択
                </div>
                <div className="flex items-end gap-3">
                  <div className="flex-1">
                    <select
                      value={selectedChannelId}
                      onChange={(e) => setSelectedChannelId(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">チャンネルを選択...</option>
                      {channels.map((ch) => (
                        <option key={ch.id} value={ch.id}>
                          #{ch.name}
                          {ch.is_private && ' (Private)'}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    onClick={handleLink}
                    disabled={!selectedChannelId || linkChannel.isPending}
                    className="flex items-center gap-1 px-4 py-2 text-sm text-white bg-[#4A154B] hover:bg-[#611f64] disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
                  >
                    {linkChannel.isPending ? '連携中...' : '連携する'}
                  </button>
                </div>
              </div>
              <p className="text-xs text-gray-500">
                Botを先にチャンネルに招待してください: <code className="bg-gray-100 px-1 rounded">/invite @TaskApp</code>
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
