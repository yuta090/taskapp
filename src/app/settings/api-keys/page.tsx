'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  ArrowLeft,
  Key,
  Plus,
  Trash,
  Copy,
  Check,
  Eye,
  EyeSlash,
  Warning,
  CircleNotch,
  CheckSquare,
  Square,
} from '@phosphor-icons/react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useCurrentUser } from '@/lib/hooks/useCurrentUser'
import { useUserSpaces, UserSpace } from '@/lib/hooks/useUserSpaces'

interface ApiKey {
  id: string
  name: string
  key_prefix: string
  created_at: string
  last_used_at: string | null
  expires_at: string | null
  is_active: boolean
  scope: 'space' | 'org' | 'user'
  allowed_space_ids: string[] | null
  allowed_actions: string[]
}

// Generate a random API key
function generateApiKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const prefix = 'tsk_'
  let key = prefix
  for (let i = 0; i < 32; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return key
}

// SHA-256 hash function
async function hashKey(key: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(key)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

export default function ApiKeysSettingsPage() {
  const { user, loading: userLoading } = useCurrentUser()
  const { spaces, loading: spacesLoading } = useUserSpaces()
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // New key form state
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [selectedSpaces, setSelectedSpaces] = useState<string[]>([])
  const [allowedActions, setAllowedActions] = useState<string[]>(['read'])
  const [creating, setCreating] = useState(false)

  // Newly created key modal
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [showKey, setShowKey] = useState(false)

  const supabase = useMemo(() => createClient(), [])

  const fetchApiKeys = useCallback(async () => {
    if (!user) return

    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/keys/user`)
      const result = await response.json()

      if (!response.ok) throw new Error(result.error)
      setApiKeys(result.data || [])
    } catch (err) {
      console.error('Failed to fetch API keys:', err)
      setError('APIキーの取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    if (!userLoading && user) {
      void fetchApiKeys()
    }
  }, [userLoading, user, fetchApiKeys])

  const handleCreate = async () => {
    if (!newKeyName.trim() || selectedSpaces.length === 0) return
    setCreating(true)
    try {
      if (!user) throw new Error('認証が必要です')

      // Generate key
      const rawKey = generateApiKey()
      const keyHash = await hashKey(rawKey)
      const keyPrefix = rawKey.substring(0, 12) + '...'

      const response = await fetch('/api/keys/user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newKeyName.trim(),
          keyHash,
          keyPrefix,
          allowedSpaceIds: selectedSpaces,
          allowedActions,
        }),
      })

      const result = await response.json()
      if (!response.ok) throw new Error(result.error)

      // Show the key (only once)
      setNewlyCreatedKey(rawKey)
      setNewKeyName('')
      setSelectedSpaces([])
      setAllowedActions(['read'])
      setShowCreateForm(false)
      await fetchApiKeys()
    } catch (err) {
      console.error('Failed to create API key:', err)
      alert('APIキーの作成に失敗しました')
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('このAPIキーを削除しますか？この操作は取り消せません。')) return
    try {
      const response = await fetch(`/api/keys/user?id=${id}`, { method: 'DELETE' })
      const result = await response.json()

      if (!response.ok) throw new Error(result.error)
      await fetchApiKeys()
    } catch (err) {
      console.error('Failed to delete API key:', err)
      alert('APIキーの削除に失敗しました')
    }
  }

  const handleCopyKey = async () => {
    if (!newlyCreatedKey) return
    await navigator.clipboard.writeText(newlyCreatedKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const closeNewKeyModal = () => {
    setNewlyCreatedKey(null)
    setShowKey(false)
    setCopied(false)
  }

  const toggleSpace = (spaceId: string) => {
    setSelectedSpaces((prev) =>
      prev.includes(spaceId) ? prev.filter((id) => id !== spaceId) : [...prev, spaceId]
    )
  }

  const toggleAction = (action: string) => {
    setAllowedActions((prev) => {
      if (action === 'read') return prev // read is always required
      return prev.includes(action) ? prev.filter((a) => a !== action) : [...prev, action]
    })
  }

  const selectAllSpaces = () => {
    setSelectedSpaces(spaces.map((s) => s.id))
  }

  const deselectAllSpaces = () => {
    setSelectedSpaces([])
  }

  // Get space names for display
  const getSpaceNames = (spaceIds: string[] | null): string => {
    if (!spaceIds || spaceIds.length === 0) return '全スペース'
    if (spaceIds.length === spaces.length) return '全スペース'
    const names = spaceIds
      .map((id) => spaces.find((s) => s.id === id)?.name)
      .filter(Boolean)
      .slice(0, 2)
    if (spaceIds.length > 2) {
      return `${names.join(', ')} 他${spaceIds.length - 2}件`
    }
    return names.join(', ')
  }

  if (userLoading || spacesLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <CircleNotch className="w-8 h-8 text-indigo-500 animate-spin" />
      </div>
    )
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600 mb-4">ログインが必要です</p>
          <Link href="/login" className="text-indigo-600 hover:underline">
            ログインページへ
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <Link
              href="/settings/account"
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-xl font-semibold text-gray-900">APIキー管理</h1>
              <p className="text-sm text-gray-500">
                外部ツール連携用のAPIキーを管理します
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        {/* Error */}
        {error && (
          <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-700">
            {error}
          </div>
        )}

        {/* Newly created key modal */}
        {newlyCreatedKey && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 max-w-lg w-full mx-4 shadow-xl">
              <div className="flex items-center gap-2 text-amber-600 mb-4">
                <Warning className="text-xl" weight="fill" />
                <h4 className="font-medium">APIキーを保存してください</h4>
              </div>
              <p className="text-sm text-gray-600 mb-4">
                このキーは一度しか表示されません。安全な場所に保存してください。
              </p>
              <div className="bg-gray-50 rounded-lg p-3 font-mono text-sm break-all flex items-center gap-2">
                <span className="flex-1">{showKey ? newlyCreatedKey : '•'.repeat(40)}</span>
                <button
                  onClick={() => setShowKey(!showKey)}
                  className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded"
                  title={showKey ? 'キーを隠す' : 'キーを表示'}
                >
                  {showKey ? <EyeSlash className="text-lg" /> : <Eye className="text-lg" />}
                </button>
                <button
                  onClick={handleCopyKey}
                  className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded"
                  title="コピー"
                >
                  {copied ? (
                    <Check className="text-lg text-green-600" />
                  ) : (
                    <Copy className="text-lg" />
                  )}
                </button>
              </div>
              <div className="mt-6 flex justify-end">
                <button
                  onClick={closeNewKeyModal}
                  className="px-4 py-2 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800"
                >
                  閉じる
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Create form */}
        {showCreateForm ? (
          <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-gray-900">新規APIキー作成</h3>
              <button
                onClick={() => setShowCreateForm(false)}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                キャンセル
              </button>
            </div>

            {/* Key name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                キー名
              </label>
              <input
                type="text"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="例: Claude Code用"
                maxLength={50}
                className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>

            {/* Allowed spaces */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-700">
                  アクセス許可するプロジェクト
                </label>
                <div className="flex gap-2 text-xs">
                  <button
                    type="button"
                    onClick={selectAllSpaces}
                    className="text-indigo-600 hover:text-indigo-700"
                  >
                    すべて選択
                  </button>
                  <span className="text-gray-300">|</span>
                  <button
                    type="button"
                    onClick={deselectAllSpaces}
                    className="text-gray-500 hover:text-gray-700"
                  >
                    すべて解除
                  </button>
                </div>
              </div>
              <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-48 overflow-y-auto">
                {spaces.length === 0 ? (
                  <div className="px-4 py-3 text-sm text-gray-500">
                    所属しているプロジェクトがありません
                  </div>
                ) : (
                  spaces.map((space) => (
                    <label
                      key={space.id}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 cursor-pointer"
                    >
                      <button
                        type="button"
                        onClick={() => toggleSpace(space.id)}
                        className="text-lg text-gray-500"
                      >
                        {selectedSpaces.includes(space.id) ? (
                          <CheckSquare className="text-indigo-600" weight="fill" />
                        ) : (
                          <Square />
                        )}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate">
                          {space.name}
                        </div>
                        <div className="text-xs text-gray-500">{space.orgName}</div>
                      </div>
                      <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">
                        {space.role}
                      </span>
                    </label>
                  ))
                )}
              </div>
              {selectedSpaces.length === 0 && (
                <p className="text-xs text-red-500 mt-1">
                  少なくとも1つのプロジェクトを選択してください
                </p>
              )}
            </div>

            {/* Allowed actions */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                許可する操作
              </label>
              <div className="flex flex-wrap gap-2">
                {[
                  { value: 'read', label: '読み取り', description: 'タスク一覧取得など' },
                  { value: 'write', label: '書き込み', description: 'タスク作成・更新' },
                  { value: 'delete', label: '削除', description: 'タスク削除' },
                ].map((action) => (
                  <button
                    key={action.value}
                    type="button"
                    onClick={() => toggleAction(action.value)}
                    disabled={action.value === 'read'}
                    className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
                      allowedActions.includes(action.value)
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                        : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                    } ${action.value === 'read' ? 'cursor-not-allowed' : ''}`}
                    title={action.description}
                  >
                    {action.label}
                    {action.value === 'read' && (
                      <span className="ml-1 text-xs text-gray-400">(必須)</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Create button */}
            <div className="flex justify-end pt-2">
              <button
                onClick={handleCreate}
                disabled={!newKeyName.trim() || selectedSpaces.length === 0 || creating}
                className="flex items-center gap-2 px-6 py-2.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
              >
                {creating ? (
                  <CircleNotch className="w-4 h-4 animate-spin" />
                ) : (
                  <Key className="w-4 h-4" />
                )}
                {creating ? '作成中...' : 'APIキーを発行'}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowCreateForm(true)}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium text-indigo-600 bg-white border border-indigo-200 hover:bg-indigo-50 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            新しいAPIキーを作成
          </button>
        )}

        {/* API keys list */}
        <div className="bg-white rounded-lg border border-gray-200">
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="font-medium text-gray-900 flex items-center gap-2">
              <Key className="text-gray-500" />
              発行済みAPIキー
            </h3>
          </div>

          {loading ? (
            <div className="px-4 py-8 text-center text-sm text-gray-500">
              読み込み中...
            </div>
          ) : apiKeys.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-500">
              APIキーはまだ作成されていません
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {apiKeys.map((key) => (
                <div key={key.id} className="px-4 py-3 hover:bg-gray-50">
                  <div className="flex items-start gap-3">
                    <Key className="text-gray-400 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900">{key.name}</span>
                        {!key.is_active && (
                          <span className="text-xs text-red-600 bg-red-50 px-1.5 py-0.5 rounded">
                            無効
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 font-mono mt-0.5">
                        {key.key_prefix}
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-xs text-gray-500">
                        <span>
                          プロジェクト: {getSpaceNames(key.allowed_space_ids)}
                        </span>
                        <span>
                          操作: {key.allowed_actions.join(', ')}
                        </span>
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        作成: {new Date(key.created_at).toLocaleDateString('ja-JP')}
                        {key.last_used_at && (
                          <span className="ml-3">
                            最終使用: {new Date(key.last_used_at).toLocaleDateString('ja-JP')}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleDelete(key.id)}
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                      title="削除"
                    >
                      <Trash className="text-sm" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Usage instructions */}
        <div className="bg-gray-50 rounded-lg p-4 text-sm">
          <h4 className="font-medium text-gray-700 mb-2">使用方法</h4>
          <p className="text-gray-600 mb-2">
            発行したAPIキーを環境変数に設定してください:
          </p>
          <pre className="bg-gray-900 text-gray-100 p-3 rounded-lg text-xs overflow-x-auto">
            {`TASKAPP_API_KEY=<発行したAPIキー>
TASKAPP_API_URL=${typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'}/api`}
          </pre>
          <p className="text-xs text-gray-500 mt-2">
            ※ スペースIDは自動的にAPIキーに紐付けられているため、個別設定は不要です
          </p>
        </div>
      </main>
    </div>
  )
}
