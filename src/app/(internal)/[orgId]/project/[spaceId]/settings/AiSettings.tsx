'use client'

import { useState } from 'react'
import {
  Brain,
  Trash,
  CheckCircle,
  Warning,
  Key,
} from '@phosphor-icons/react'
import { useAiConfig, useSaveAiConfig, useDeleteAiConfig } from '@/lib/hooks/useAiConfig'
import { toast } from 'sonner'

interface AiSettingsProps {
  orgId: string
  spaceId: string
}

const PROVIDERS = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
] as const

const MODELS: Record<string, { value: string; label: string }[]> = {
  openai: [
    { value: 'gpt-4o-mini', label: 'GPT-4o mini' },
    { value: 'gpt-4o', label: 'GPT-4o' },
  ],
  anthropic: [
    { value: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5' },
    { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  ],
}

export function AiSettings({ orgId }: AiSettingsProps) {
  const [provider, setProvider] = useState<string>('openai')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('gpt-4o-mini')
  const [formError, setFormError] = useState('')

  const { data: config, isLoading } = useAiConfig(orgId)
  const saveConfig = useSaveAiConfig()
  const deleteConfig = useDeleteAiConfig()

  const handleProviderChange = (newProvider: string) => {
    setProvider(newProvider)
    setModel(MODELS[newProvider]?.[0]?.value || '')
    setFormError('')
  }

  const handleSave = async () => {
    setFormError('')

    if (!apiKey.trim()) {
      setFormError('APIキーを入力してください')
      return
    }

    if (provider === 'openai' && !apiKey.startsWith('sk-')) {
      setFormError('OpenAI APIキーは sk- で始まる必要があります')
      return
    }

    if (provider === 'anthropic' && !apiKey.startsWith('sk-ant-')) {
      setFormError('Anthropic APIキーは sk-ant- で始まる必要があります')
      return
    }

    try {
      await saveConfig.mutateAsync({
        orgId,
        provider,
        apiKey: apiKey.trim(),
        model,
      })
      setApiKey('')
      setFormError('')
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'APIキーの保存に失敗しました')
    }
  }

  const handleDelete = async () => {
    if (!confirm('AI設定を削除しますか？\nSlackでのAIメンション機能が無効になります。')) return

    try {
      await deleteConfig.mutateAsync(orgId)
    } catch (err) {
      console.error('Failed to delete AI config:', err)
      toast.error('AI設定の削除に失敗しました')
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-gray-700">
          <Brain className="text-lg" weight="bold" />
          <h3 className="font-medium">AI設定</h3>
        </div>
        <div className="p-4 text-sm text-gray-500">読み込み中...</div>
      </div>
    )
  }

  // 設定済みの場合
  if (config) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-gray-700">
          <Brain className="text-lg" weight="bold" />
          <h3 className="font-medium">AI設定</h3>
        </div>

        {/* 現在の設定表示 */}
        <div className="flex items-center justify-between bg-green-50 rounded-lg px-4 py-3">
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle className="text-green-600" weight="fill" />
            <span className="text-gray-700">
              <strong>{config.provider === 'openai' ? 'OpenAI' : 'Anthropic'}</strong> と連携中
            </span>
          </div>
          <button
            onClick={handleDelete}
            disabled={deleteConfig.isPending}
            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
            title="AI設定を削除"
          >
            <Trash className="text-sm" />
          </button>
        </div>

        <div className="border border-gray-200 rounded-lg p-4 space-y-3">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-500">プロバイダー</span>
              <p className="font-medium text-gray-800">
                {config.provider === 'openai' ? 'OpenAI' : 'Anthropic'}
              </p>
            </div>
            <div>
              <span className="text-gray-500">モデル</span>
              <p className="font-medium text-gray-800">{config.model}</p>
            </div>
            <div>
              <span className="text-gray-500">APIキー</span>
              <p className="font-mono text-gray-800">{config.keyPrefix}</p>
            </div>
            <div>
              <span className="text-gray-500">ステータス</span>
              <p className={config.enabled ? 'text-green-600 font-medium' : 'text-gray-400'}>
                {config.enabled ? '有効' : '無効'}
              </p>
            </div>
          </div>
        </div>

        {/* APIキー更新フォーム */}
        <div className="border border-gray-200 rounded-lg p-4 space-y-3">
          <h4 className="text-sm font-medium text-gray-700">APIキーを更新</h4>
          <div className="space-y-2">
            <div className="flex gap-2">
              <select
                value={provider}
                onChange={(e) => handleProviderChange(e.target.value)}
                className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {PROVIDERS.map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {(MODELS[provider] || []).map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value)
                setFormError('')
              }}
              placeholder={provider === 'openai' ? 'sk-...' : 'sk-ant-...'}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
            />
            {formError && (
              <p className="flex items-center gap-1 text-xs text-red-600">
                <Warning weight="bold" />
                {formError}
              </p>
            )}
            <button
              onClick={handleSave}
              disabled={!apiKey.trim() || saveConfig.isPending}
              className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
            >
              {saveConfig.isPending ? '保存中...' : 'APIキーを更新'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // 未設定の場合：登録フォーム
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-gray-700">
        <Brain className="text-lg" weight="bold" />
        <h3 className="font-medium">AI設定</h3>
      </div>

      <div className="space-y-3">
        <p className="text-sm text-gray-600">
          LLM APIキーを登録して、SlackでのAIメンション機能を有効にできます。
        </p>

        <div className="border border-gray-200 rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm text-gray-700 mb-2">
            <Key weight="bold" />
            <span className="font-medium">APIキー登録</span>
          </div>

          <div className="space-y-2">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">プロバイダー</label>
              <select
                value={provider}
                onChange={(e) => handleProviderChange(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {PROVIDERS.map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">モデル</label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {(MODELS[provider] || []).map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">APIキー</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value)
                  setFormError('')
                }}
                placeholder={provider === 'openai' ? 'sk-...' : 'sk-ant-...'}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
              />
            </div>

            {formError && (
              <p className="flex items-center gap-1 text-xs text-red-600">
                <Warning weight="bold" />
                {formError}
              </p>
            )}

            <button
              onClick={handleSave}
              disabled={!apiKey.trim() || saveConfig.isPending}
              className="w-full px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
            >
              {saveConfig.isPending ? '保存中...' : 'APIキーを保存'}
            </button>
          </div>

          <p className="text-xs text-gray-500">
            APIキーは暗号化して保存されます。プレフィックスのみ表示されます。
          </p>
        </div>
      </div>
    </div>
  )
}
