'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  ArrowLeft,
  GithubLogo,
  ChatCircleDots,
  Brain,
  Trash,
  CheckCircle,
  ArrowSquareOut,
  PlugsConnected,
  Key,
  CaretDown,
  Warning,
  CircleNotch,
  Crown,
} from '@phosphor-icons/react'
import Link from 'next/link'
import { toast } from 'sonner'
import { useCurrentOrg } from '@/lib/hooks/useCurrentOrg'
import { useGitHubInstallation } from '@/lib/hooks/useGitHub'
import {
  useSlackWorkspace,
  useSaveSlackToken,
  useDisconnectSlack,
} from '@/lib/hooks/useSlack'
import { useAiConfig, useSaveAiConfig, useDeleteAiConfig } from '@/lib/hooks/useAiConfig'
import { isGitHubConfigured, getGitHubInstallUrl } from '@/lib/github/config'
import { isSlackConfigured } from '@/lib/slack/config'
import { useConfirmDialog } from '@/components/shared'

const AI_PROVIDERS = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
] as const

const AI_MODELS: Record<string, { value: string; label: string }[]> = {
  openai: [
    { value: 'gpt-4o-mini', label: 'GPT-4o mini' },
    { value: 'gpt-4o', label: 'GPT-4o' },
  ],
  anthropic: [
    { value: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5' },
    { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  ],
}

export default function OrgIntegrationsPage() {
  const searchParams = useSearchParams()
  const { orgId, orgName, role, loading: orgLoading } = useCurrentOrg()
  const { confirm, ConfirmDialog } = useConfirmDialog()
  const isOwner = role === 'owner'

  // OAuthコールバック後のトースト表示
  useEffect(() => {
    const slack = searchParams.get('slack')
    if (!slack) return

    if (slack === 'connected') {
      toast.success('Slackワークスペースを接続しました')
    } else if (slack === 'cancelled') {
      toast.info('Slack連携がキャンセルされました')
    } else if (slack === 'error') {
      const message = searchParams.get('message')
      toast.error(`Slack連携に失敗しました${message ? `: ${message}` : ''}`)
    }

    window.history.replaceState({}, '', '/settings/org-integrations')
  }, [searchParams])

  // GitHub
  const gitHubConfigured = isGitHubConfigured()
  const { data: installation, isLoading: loadingGitHub } = useGitHubInstallation(orgId ?? undefined)

  // Slack
  const slackConfigured = isSlackConfigured()
  const { data: workspace, isLoading: loadingSlack } = useSlackWorkspace(orgId ?? undefined)
  const saveSlackToken = useSaveSlackToken()
  const disconnectSlack = useDisconnectSlack()
  const [showSlackManualInput, setShowSlackManualInput] = useState(false)
  const [slackBotToken, setSlackBotToken] = useState('')
  const [slackTokenError, setSlackTokenError] = useState('')

  // AI
  const { data: aiConfig, isLoading: loadingAi } = useAiConfig(orgId ?? undefined)
  const saveAiConfig = useSaveAiConfig()
  const deleteAiConfig = useDeleteAiConfig()
  const [aiProvider, setAiProvider] = useState<string>('openai')
  const [aiApiKey, setAiApiKey] = useState('')
  const [aiModel, setAiModel] = useState('gpt-4o-mini')
  const [aiFormError, setAiFormError] = useState('')

  const handleSlackOAuth = () => {
    window.location.href = `/api/slack/authorize?orgId=${orgId}`
  }

  const handleSlackManualSave = async () => {
    if (!orgId) return
    setSlackTokenError('')
    if (!slackBotToken.trim()) {
      setSlackTokenError('Bot Tokenを入力してください')
      return
    }
    if (!slackBotToken.startsWith('xoxb-')) {
      setSlackTokenError('Bot Tokenは xoxb- で始まる必要があります')
      return
    }
    try {
      await saveSlackToken.mutateAsync({ orgId, botToken: slackBotToken.trim() })
      setSlackBotToken('')
      setShowSlackManualInput(false)
    } catch (err) {
      setSlackTokenError(err instanceof Error ? err.message : 'トークンの保存に失敗しました')
    }
  }

  const handleSlackDisconnect = async () => {
    if (!orgId) return
    const ok = await confirm({
      title: 'Slack連携を解除',
      message: 'Slack連携を解除しますか？すべてのプロジェクトのチャンネル紐付けも解除されます。',
      confirmLabel: '解除',
      variant: 'danger',
    })
    if (!ok) return
    try {
      await disconnectSlack.mutateAsync(orgId)
      toast.success('Slack連携を解除しました')
    } catch {
      toast.error('連携の解除に失敗しました')
    }
  }

  const handleAiProviderChange = (newProvider: string) => {
    setAiProvider(newProvider)
    setAiModel(AI_MODELS[newProvider]?.[0]?.value || '')
    setAiFormError('')
  }

  const handleAiSave = async () => {
    if (!orgId) return
    setAiFormError('')
    if (!aiApiKey.trim()) {
      setAiFormError('APIキーを入力してください')
      return
    }
    if (aiProvider === 'openai' && !aiApiKey.startsWith('sk-')) {
      setAiFormError('OpenAI APIキーは sk- で始まる必要があります')
      return
    }
    if (aiProvider === 'anthropic' && !aiApiKey.startsWith('sk-ant-')) {
      setAiFormError('Anthropic APIキーは sk-ant- で始まる必要があります')
      return
    }
    try {
      await saveAiConfig.mutateAsync({
        orgId,
        provider: aiProvider,
        apiKey: aiApiKey.trim(),
        model: aiModel,
      })
      setAiApiKey('')
      setAiFormError('')
    } catch (err) {
      setAiFormError(err instanceof Error ? err.message : 'APIキーの保存に失敗しました')
    }
  }

  const handleAiDelete = async () => {
    if (!orgId) return
    const ok = await confirm({
      title: 'AI設定を削除',
      message: 'AI設定を削除しますか？SlackでのAIメンション機能が無効になります。',
      confirmLabel: '削除',
      variant: 'danger',
    })
    if (!ok) return
    try {
      await deleteAiConfig.mutateAsync(orgId)
    } catch {
      toast.error('AI設定の削除に失敗しました')
    }
  }

  if (orgLoading || !orgId) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <CircleNotch className="w-8 h-8 text-indigo-500 animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {ConfirmDialog}
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <Link
              href="/inbox"
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-xl font-semibold text-gray-900">組織の外部連携</h1>
              <p className="text-sm text-gray-500">{orgName} の外部サービス設定</p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        {!isOwner && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-center gap-2">
            <Crown className="w-4 h-4 text-amber-600" weight="fill" />
            <p className="text-sm text-amber-700">
              組織の外部連携はオーナーのみ変更できます。現在の設定を確認できます。
            </p>
          </div>
        )}

        {/* GitHub */}
        {gitHubConfigured && (
          <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
            <div className="flex items-center gap-2 text-gray-700">
              <GithubLogo className="text-lg" weight="bold" />
              <h3 className="font-medium">GitHub</h3>
            </div>

            {loadingGitHub ? (
              <div className="p-4 text-sm text-gray-500">読み込み中...</div>
            ) : installation ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle className="text-green-500" weight="fill" />
                  <span className="text-gray-600">
                    <strong>{installation.account_login}</strong> と連携中
                  </span>
                  <a
                    href="https://github.com/settings/installations"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline ml-2"
                  >
                    設定を変更
                    <ArrowSquareOut className="inline ml-0.5 text-xs" />
                  </a>
                </div>
                <p className="text-xs text-gray-500">
                  各プロジェクト設定でリポジトリを紐付けできます。
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-gray-600">
                  GitHubと連携して、PRとタスクを自動で紐付けできます。
                </p>
                {isOwner && (
                  <a
                    href={getGitHubInstallUrl(orgId, '/settings/org-integrations')}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm text-white bg-gray-900 hover:bg-gray-800 rounded-lg transition-colors"
                  >
                    <GithubLogo className="text-lg" />
                    GitHubと連携する
                    <ArrowSquareOut className="text-sm" />
                  </a>
                )}
              </div>
            )}
          </div>
        )}

        {/* Slack */}
        {slackConfigured && (
          <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
            <div className="flex items-center gap-2 text-gray-700">
              <ChatCircleDots className="text-lg" weight="bold" />
              <h3 className="font-medium">Slack</h3>
            </div>

            {loadingSlack ? (
              <div className="p-4 text-sm text-gray-500">読み込み中...</div>
            ) : workspace ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between bg-green-50 rounded-lg px-4 py-3">
                  <div className="flex items-center gap-2 text-sm">
                    <CheckCircle className="text-green-600" weight="fill" />
                    <span className="text-gray-700">
                      <strong>{workspace.team_name}</strong> と連携中
                    </span>
                  </div>
                  {isOwner && (
                    <button
                      onClick={handleSlackDisconnect}
                      disabled={disconnectSlack.isPending}
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                      title="連携を解除"
                    >
                      <Trash className="text-sm" />
                    </button>
                  )}
                </div>
                <p className="text-xs text-gray-500">
                  各プロジェクト設定で通知先チャンネルを選択できます。
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-gray-600">
                  Slackワークスペースを連携して、タスク情報を共有できます。
                </p>

                {isOwner && (
                  <>
                    <button
                      onClick={handleSlackOAuth}
                      className="flex items-center gap-2 w-full px-4 py-3 text-sm font-medium text-white bg-[#4A154B] hover:bg-[#611f64] rounded-lg transition-colors"
                    >
                      <PlugsConnected weight="bold" />
                      Slackと連携する
                    </button>

                    <div className="border border-gray-200 rounded-lg">
                      <button
                        onClick={() => setShowSlackManualInput(!showSlackManualInput)}
                        className="flex items-center justify-between w-full px-4 py-3 text-sm text-gray-600 hover:bg-gray-50 rounded-lg"
                      >
                        <span className="flex items-center gap-2">
                          <Key weight="bold" />
                          手動でBot Tokenを入力
                        </span>
                        <CaretDown
                          className={`transition-transform ${showSlackManualInput ? 'rotate-180' : ''}`}
                        />
                      </button>

                      {showSlackManualInput && (
                        <div className="px-4 pb-4 space-y-3">
                          <p className="text-xs text-gray-500">
                            Slack App の OAuth & Permissions から Bot User OAuth Token をコピーしてください。
                          </p>
                          <input
                            type="password"
                            value={slackBotToken}
                            onChange={(e) => {
                              setSlackBotToken(e.target.value)
                              setSlackTokenError('')
                            }}
                            placeholder="xoxb-..."
                            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                          />
                          {slackTokenError && (
                            <p className="flex items-center gap-1 text-xs text-red-600">
                              <Warning weight="bold" />
                              {slackTokenError}
                            </p>
                          )}
                          <button
                            onClick={handleSlackManualSave}
                            disabled={!slackBotToken.trim() || saveSlackToken.isPending}
                            className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
                          >
                            {saveSlackToken.isPending ? '検証中...' : 'トークンを保存'}
                          </button>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* AI Settings */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
          <div className="flex items-center gap-2 text-gray-700">
            <Brain className="text-lg" weight="bold" />
            <h3 className="font-medium">AI設定</h3>
          </div>

          {loadingAi ? (
            <div className="p-4 text-sm text-gray-500">読み込み中...</div>
          ) : aiConfig ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between bg-green-50 rounded-lg px-4 py-3">
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle className="text-green-600" weight="fill" />
                  <span className="text-gray-700">
                    <strong>{aiConfig.provider === 'openai' ? 'OpenAI' : 'Anthropic'}</strong> と連携中
                  </span>
                </div>
                {isOwner && (
                  <button
                    onClick={handleAiDelete}
                    disabled={deleteAiConfig.isPending}
                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                    title="AI設定を削除"
                  >
                    <Trash className="text-sm" />
                  </button>
                )}
              </div>

              <div className="border border-gray-200 rounded-lg p-4 space-y-3">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-500">プロバイダー</span>
                    <p className="font-medium text-gray-800">
                      {aiConfig.provider === 'openai' ? 'OpenAI' : 'Anthropic'}
                    </p>
                  </div>
                  <div>
                    <span className="text-gray-500">モデル</span>
                    <p className="font-medium text-gray-800">{aiConfig.model}</p>
                  </div>
                  <div>
                    <span className="text-gray-500">APIキー</span>
                    <p className="font-mono text-gray-800">{aiConfig.keyPrefix}</p>
                  </div>
                  <div>
                    <span className="text-gray-500">ステータス</span>
                    <p className={aiConfig.enabled ? 'text-green-600 font-medium' : 'text-gray-400'}>
                      {aiConfig.enabled ? '有効' : '無効'}
                    </p>
                  </div>
                </div>
              </div>

              {/* APIキー更新フォーム (owner only) */}
              {isOwner && (
                <div className="border border-gray-200 rounded-lg p-4 space-y-3">
                  <h4 className="text-sm font-medium text-gray-700">APIキーを更新</h4>
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <select
                        value={aiProvider}
                        onChange={(e) => handleAiProviderChange(e.target.value)}
                        className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        {AI_PROVIDERS.map(p => (
                          <option key={p.value} value={p.value}>{p.label}</option>
                        ))}
                      </select>
                      <select
                        value={aiModel}
                        onChange={(e) => setAiModel(e.target.value)}
                        className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        {(AI_MODELS[aiProvider] || []).map(m => (
                          <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                      </select>
                    </div>
                    <input
                      type="password"
                      value={aiApiKey}
                      onChange={(e) => {
                        setAiApiKey(e.target.value)
                        setAiFormError('')
                      }}
                      placeholder={aiProvider === 'openai' ? 'sk-...' : 'sk-ant-...'}
                      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                    />
                    {aiFormError && (
                      <p className="flex items-center gap-1 text-xs text-red-600">
                        <Warning weight="bold" />
                        {aiFormError}
                      </p>
                    )}
                    <button
                      onClick={handleAiSave}
                      disabled={!aiApiKey.trim() || saveAiConfig.isPending}
                      className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
                    >
                      {saveAiConfig.isPending ? '保存中...' : 'APIキーを更新'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-gray-600">
                LLM APIキーを登録して、SlackでのAIメンション機能を有効にできます。
              </p>

              {isOwner && (
                <div className="border border-gray-200 rounded-lg p-4 space-y-3">
                  <div className="flex items-center gap-2 text-sm text-gray-700 mb-2">
                    <Key weight="bold" />
                    <span className="font-medium">APIキー登録</span>
                  </div>
                  <div className="space-y-2">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">プロバイダー</label>
                      <select
                        value={aiProvider}
                        onChange={(e) => handleAiProviderChange(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        {AI_PROVIDERS.map(p => (
                          <option key={p.value} value={p.value}>{p.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">モデル</label>
                      <select
                        value={aiModel}
                        onChange={(e) => setAiModel(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        {(AI_MODELS[aiProvider] || []).map(m => (
                          <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">APIキー</label>
                      <input
                        type="password"
                        value={aiApiKey}
                        onChange={(e) => {
                          setAiApiKey(e.target.value)
                          setAiFormError('')
                        }}
                        placeholder={aiProvider === 'openai' ? 'sk-...' : 'sk-ant-...'}
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                      />
                    </div>
                    {aiFormError && (
                      <p className="flex items-center gap-1 text-xs text-red-600">
                        <Warning weight="bold" />
                        {aiFormError}
                      </p>
                    )}
                    <button
                      onClick={handleAiSave}
                      disabled={!aiApiKey.trim() || saveAiConfig.isPending}
                      className="w-full px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
                    >
                      {saveAiConfig.isPending ? '保存中...' : 'APIキーを保存'}
                    </button>
                  </div>
                  <p className="text-xs text-gray-500">
                    APIキーは暗号化して保存されます。プレフィックスのみ表示されます。
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
