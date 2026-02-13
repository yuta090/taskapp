'use client'

import { useState } from 'react'
import {
  ChatCircleDots,
  Trash,
  CheckCircle,
  Link as LinkIcon,
  CaretDown,
  Key,
  PlugsConnected,
  Warning,
} from '@phosphor-icons/react'
import {
  useSlackWorkspace,
  useSlackChannel,
  useSlackChannelList,
  useLinkSlackChannel,
  useUnlinkSlackChannel,
  useSaveSlackToken,
  useDisconnectSlack,
  useUpdateNotifyToggles,
} from '@/lib/hooks/useSlack'
import { isSlackConfigured } from '@/lib/slack/config'

interface SlackSettingsProps {
  orgId: string
  spaceId: string
}

export function SlackSettings({ orgId, spaceId }: SlackSettingsProps) {
  const [selectedChannelId, setSelectedChannelId] = useState('')
  const [showManualInput, setShowManualInput] = useState(false)
  const [botToken, setBotToken] = useState('')
  const [tokenError, setTokenError] = useState('')

  const { data: workspace, isLoading: loadingWorkspace } = useSlackWorkspace(orgId)
  const { data: linkedChannel, isLoading: loadingLinked } = useSlackChannel(spaceId)
  const { data: channels = [], isLoading: loadingChannels } = useSlackChannelList(orgId)
  const linkChannel = useLinkSlackChannel()
  const unlinkChannel = useUnlinkSlackChannel()
  const saveToken = useSaveSlackToken()
  const disconnectSlack = useDisconnectSlack()
  const updateToggles = useUpdateNotifyToggles()

  const isConfigured = isSlackConfigured()

  const handleOAuth = () => {
    window.location.href = `/api/slack/authorize?orgId=${orgId}&spaceId=${spaceId}`
  }

  const handleManualSave = async () => {
    setTokenError('')

    if (!botToken.trim()) {
      setTokenError('Bot Tokenを入力してください')
      return
    }

    if (!botToken.startsWith('xoxb-')) {
      setTokenError('Bot Tokenは xoxb- で始まる必要があります')
      return
    }

    try {
      await saveToken.mutateAsync({ orgId, botToken: botToken.trim() })
      setBotToken('')
      setShowManualInput(false)
    } catch (err) {
      setTokenError(err instanceof Error ? err.message : 'トークンの保存に失敗しました')
    }
  }

  const handleDisconnect = async () => {
    if (!confirm('Slack連携を解除しますか？\nすべてのプロジェクトのチャンネル紐付けも解除されます。')) return

    try {
      await disconnectSlack.mutateAsync(orgId)
    } catch (err) {
      console.error('Failed to disconnect Slack:', err)
      alert('連携の解除に失敗しました')
    }
  }

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
    } catch (err) {
      console.error('Failed to link channel:', err)
      alert('チャンネルの連携に失敗しました')
    }
  }

  const handleUnlink = async () => {
    if (!confirm('このSlackチャンネルの連携を解除しますか？')) return

    try {
      await unlinkChannel.mutateAsync(spaceId)
    } catch (err) {
      console.error('Failed to unlink channel:', err)
      alert('連携の解除に失敗しました')
    }
  }

  // Slack機能自体が無効
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

  // === State 1: ワークスペース未連携 ===
  if (!isLoading && !workspace) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-gray-700">
          <ChatCircleDots className="text-lg" weight="bold" />
          <h3 className="font-medium">Slack連携</h3>
        </div>

        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            Slackワークスペースを連携して、タスク情報を共有できます。
          </p>

          {/* OAuth ボタン */}
          <button
            onClick={handleOAuth}
            className="flex items-center gap-2 w-full px-4 py-3 text-sm font-medium text-white bg-[#4A154B] hover:bg-[#611f64] rounded-lg transition-colors"
          >
            <PlugsConnected weight="bold" />
            Slackと連携する
          </button>

          {/* 手動入力（折りたたみ） */}
          <div className="border border-gray-200 rounded-lg">
            <button
              onClick={() => setShowManualInput(!showManualInput)}
              className="flex items-center justify-between w-full px-4 py-3 text-sm text-gray-600 hover:bg-gray-50 rounded-lg"
            >
              <span className="flex items-center gap-2">
                <Key weight="bold" />
                手動でBot Tokenを入力
              </span>
              <CaretDown
                className={`transition-transform ${showManualInput ? 'rotate-180' : ''}`}
              />
            </button>

            {showManualInput && (
              <div className="px-4 pb-4 space-y-3">
                <p className="text-xs text-gray-500">
                  Slack App の OAuth & Permissions から Bot User OAuth Token をコピーしてください。
                </p>
                <input
                  type="password"
                  value={botToken}
                  onChange={(e) => {
                    setBotToken(e.target.value)
                    setTokenError('')
                  }}
                  placeholder="xoxb-..."
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                />
                {tokenError && (
                  <p className="flex items-center gap-1 text-xs text-red-600">
                    <Warning weight="bold" />
                    {tokenError}
                  </p>
                )}
                <button
                  onClick={handleManualSave}
                  disabled={!botToken.trim() || saveToken.isPending}
                  className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
                >
                  {saveToken.isPending ? '検証中...' : 'トークンを保存'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // === State 2 & 3: ワークスペース連携済み ===
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-gray-700">
        <ChatCircleDots className="text-lg" weight="bold" />
        <h3 className="font-medium">Slack連携</h3>
      </div>

      {isLoading ? (
        <div className="p-4 text-sm text-gray-500">読み込み中...</div>
      ) : (
        <div className="space-y-4">
          {/* ワークスペース情報 */}
          <div className="flex items-center justify-between bg-green-50 rounded-lg px-4 py-3">
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle className="text-green-600" weight="fill" />
              <span className="text-gray-700">
                <strong>{workspace?.team_name}</strong> と連携中
              </span>
            </div>
            <button
              onClick={handleDisconnect}
              disabled={disconnectSlack.isPending}
              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
              title="連携を解除"
            >
              <Trash className="text-sm" />
            </button>
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
