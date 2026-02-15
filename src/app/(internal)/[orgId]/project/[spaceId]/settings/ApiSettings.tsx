'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Key, Plus, Trash, Copy, Check, Eye, EyeSlash, Warning } from '@phosphor-icons/react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { toast } from 'sonner'

interface ApiKey {
  id: string
  name: string
  key_prefix: string
  created_at: string
  last_used_at: string | null
  expires_at: string | null
  is_active: boolean
}

interface ApiSettingsProps {
  orgId: string
  spaceId: string
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
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

export function ApiSettings({ orgId, spaceId }: ApiSettingsProps) {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [checkingRole, setCheckingRole] = useState(true)

  // New key form
  const [newKeyName, setNewKeyName] = useState('')
  const [creating, setCreating] = useState(false)

  // Newly created key (shown once)
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [configCopied, setConfigCopied] = useState(false)

  const supabase = useMemo(() => createClient(), [])

  // Check if user is admin
  const checkAdminRole = useCallback(async () => {
    setCheckingRole(true)
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser()

      // Development mode: if no auth session, allow access for testing
      if (!user || authError) {
        console.log('[ApiSettings] No auth session, checking development mode...')
        // In development, allow access if we're on localhost
        if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
          console.log('[ApiSettings] Development mode: allowing admin access')
          setIsAdmin(true)
          return
        }
        setIsAdmin(false)
        return
      }

      // Check org owner
       
      const { data: orgMember } = await (supabase as SupabaseClient)
        .from('org_memberships')
        .select('role')
        .eq('org_id' as never, orgId as never)
        .eq('user_id' as never, user.id as never)
        .single()

      if (orgMember?.role === 'owner') {
        setIsAdmin(true)
        return
      }

      // Check space admin
       
      const { data: spaceMember } = await (supabase as SupabaseClient)
        .from('space_memberships')
        .select('role')
        .eq('space_id' as never, spaceId as never)
        .eq('user_id' as never, user.id as never)
        .single()

      setIsAdmin(spaceMember?.role === 'admin')
    } catch (err) {
      console.error('[ApiSettings] Failed to check admin role:', err)
      // Development fallback
      if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
        setIsAdmin(true)
        return
      }
      setIsAdmin(false)
    } finally {
      setCheckingRole(false)
    }
  }, [supabase, orgId, spaceId])

  const fetchApiKeys = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/keys?orgId=${orgId}&spaceId=${spaceId}`)
      const result = await response.json()

      if (!response.ok) throw new Error(result.error)
      setApiKeys(result.data || [])
    } catch (err) {
      console.error('Failed to fetch API keys:', err)
      setError('APIキーの取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }, [orgId, spaceId])

  useEffect(() => {
    void checkAdminRole()
  }, [checkAdminRole])

  useEffect(() => {
    if (isAdmin) {
      void fetchApiKeys()
    }
  }, [isAdmin, fetchApiKeys])

  const handleCreate = async () => {
    if (!newKeyName.trim()) return
    setCreating(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()

      // Development mode fallback
      let userId = user?.id
      if (!userId && typeof window !== 'undefined' && window.location.hostname === 'localhost') {
        console.log('[ApiSettings] Development mode: using demo user for API key creation')
        userId = '0124bcca-7c66-406c-b1ae-2be8dac241c5' // demo user
      }

      if (!userId) throw new Error('認証が必要です')

      // Generate key
      const rawKey = generateApiKey()
      const keyHash = await hashKey(rawKey)
      const keyPrefix = rawKey.substring(0, 12) + '...'

      // Use API route to bypass RLS
      const response = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          spaceId,
          name: newKeyName.trim(),
          keyHash,
          keyPrefix,
          userId,
        }),
      })

      const result = await response.json()
      if (!response.ok) throw new Error(result.error)

      // Show the key (only once)
      setNewlyCreatedKey(rawKey)
      setNewKeyName('')
      await fetchApiKeys()
    } catch (err) {
      console.error('Failed to create API key:', err)
      toast.error('APIキーの作成に失敗しました')
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('このAPIキーを削除しますか？この操作は取り消せません。')) return
    try {
      const response = await fetch(`/api/keys?id=${id}`, { method: 'DELETE' })
      const result = await response.json()

      if (!response.ok) throw new Error(result.error)
      await fetchApiKeys()
    } catch (err) {
      console.error('Failed to delete API key:', err)
      toast.error('APIキーの削除に失敗しました')
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

  // Loading state
  if (checkingRole) {
    return (
      <div className="p-4 text-sm text-gray-500">
        権限を確認中...
      </div>
    )
  }

  // Not admin - show message instead of hiding
  if (!isAdmin) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-gray-700">
          <Key className="text-lg" />
          <h3 className="font-medium">API設定</h3>
        </div>
        <p className="text-sm text-gray-500">
          API設定は管理者（org owner または space admin）のみ利用可能です。
          <br />
          <span className="text-xs text-gray-400">※ コンソールでデバッグ情報を確認してください</span>
        </p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-gray-700">
          <Key className="text-lg" />
          <h3 className="font-medium">API設定</h3>
        </div>
        <div className="p-4 text-sm text-gray-500">
          読み込み中...
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-gray-700">
          <Key className="text-lg" />
          <h3 className="font-medium">API設定</h3>
        </div>
        <div className="p-4 text-sm text-red-600">
          {error}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-gray-700">
        <Key className="text-lg" />
        <h3 className="font-medium">API設定</h3>
        <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded">管理者限定</span>
      </div>

      <p className="text-sm text-gray-500">
        外部ツール（Claude Code、MCPクライアント等）からTaskAppにアクセスするためのAPIキーを管理します。
      </p>

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
              <span className="flex-1">
                {showKey ? newlyCreatedKey : '•'.repeat(40)}
              </span>
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
                {copied ? <Check className="text-lg text-green-600" /> : <Copy className="text-lg" />}
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

      {/* API keys list */}
      <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
        {apiKeys.length === 0 ? (
          <div className="px-4 py-6 text-sm text-gray-500 text-center">
            APIキーはまだ作成されていません
          </div>
        ) : (
          apiKeys.map((key) => (
            <div
              key={key.id}
              className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50"
            >
              <Key className="text-gray-400" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 truncate">
                  {key.name}
                </div>
                <div className="text-xs text-gray-500 font-mono">
                  {key.key_prefix}
                </div>
              </div>
              <div className="text-xs text-gray-400">
                {key.last_used_at
                  ? `最終使用: ${new Date(key.last_used_at).toLocaleDateString('ja-JP')}`
                  : '未使用'}
              </div>
              <button
                onClick={() => handleDelete(key.id)}
                className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                title="削除"
              >
                <Trash className="text-sm" />
              </button>
            </div>
          ))
        )}
      </div>

      {/* Add new API key */}
      <div className="border border-gray-200 rounded-lg p-4">
        <div className="text-xs font-medium text-gray-500 mb-2">
          新規APIキー
        </div>
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="text-xs text-gray-500">キー名</label>
            <input
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="例: Claude Code用"
              className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            onClick={handleCreate}
            disabled={!newKeyName.trim() || creating}
            className="flex items-center gap-1 px-4 py-2 text-sm text-white bg-gray-900 hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
          >
            <Plus className="text-sm" />
            {creating ? '作成中...' : '発行'}
          </button>
        </div>
      </div>

      {/* Usage instructions */}
      <div className="bg-gray-50 rounded-lg p-4 text-sm">
        <h4 className="font-medium text-gray-700 mb-2">環境変数設定</h4>
        <p className="text-gray-600 mb-2">
          発行したAPIキーと以下の設定を<code className="bg-gray-200 px-1 rounded">.env.local</code>に追加してください:
        </p>
        <div className="relative">
          <pre className="bg-gray-900 text-gray-100 p-3 rounded-lg text-xs overflow-x-auto">
{`TASKAPP_API_KEY=<発行したAPIキー>
TASKAPP_ORG_ID=${orgId}
TASKAPP_SPACE_ID=${spaceId}
TASKAPP_API_URL=${typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'}/api`}
          </pre>
          <button
            onClick={() => {
              const config = `TASKAPP_API_KEY=<発行したAPIキー>\nTASKAPP_ORG_ID=${orgId}\nTASKAPP_SPACE_ID=${spaceId}\nTASKAPP_API_URL=${typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'}/api`
              navigator.clipboard.writeText(config)
              setConfigCopied(true)
              setTimeout(() => setConfigCopied(false), 2000)
            }}
            className="absolute top-2 right-2 p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded"
            title="コピー"
          >
            {configCopied ? <Check className="text-green-400" /> : <Copy />}
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          ※ <code className="bg-gray-200 px-1 rounded">&lt;発行したAPIキー&gt;</code> の部分を実際のキーに置き換えてください
        </p>
      </div>
    </div>
  )
}
