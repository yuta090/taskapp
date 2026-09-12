'use client'

import { useState, useMemo, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
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
  MagnifyingGlass,
} from '@phosphor-icons/react'
import Link from 'next/link'
import { toast } from 'sonner'
import { useConfirmDialog, SettingsBackButton } from '@/components/shared'
import { useCurrentUser } from '@/lib/hooks/useCurrentUser'
import { useUserSpaces } from '@/lib/hooks/useUserSpaces'
import { API_KEY_ACTION_OPTIONS, formatApiKeyActions } from '@/lib/api-keys/actionOptions'
import { describeKeySpaces } from '@/lib/api-keys/keySpaces'
import { describeApiKeyCreateError } from '@/lib/api-keys/createErrorMessages'
import { CliSetupGuide } from '@/components/settings/CliSetupGuide'
import { isInternalSpaceRole } from '@/lib/roles/spaceRoles'

interface ApiKey {
  id: string
  name: string
  key_prefix: string
  created_at: string
  last_used_at: string | null
  expires_at: string | null
  is_active: boolean
  scope: 'space' | 'org' | 'user'
  space_id: string | null
  allowed_space_ids: string[] | null
  allowed_actions: string[]
}

export default function ApiKeysSettingsPage() {
  const { confirm, ConfirmDialog } = useConfirmDialog()
  const { user, loading: userLoading } = useCurrentUser()
  // 左メニューと同じ引数(includeArchived: true)にして、同じキャッシュ(['userSpaces', uid, true])
  // を使い回す（通信を1本減らす）。アーカイブ済みプロジェクトは、このページ側で除く
  // （このページの一覧・鍵の発行対象は、これまでどおりアーカイブ済みを含めない）
  const { spaces: allSpaces, loading: spacesLoading } = useUserSpaces({ includeArchived: true })
  const spaces = useMemo(() => allSpaces.filter((s) => s.archivedAt === null), [allSpaces])
  const queryClient = useQueryClient()
  // API キーは社内メンバー（admin / editor / viewer）専用。相手先として参加しているプロジェクトは
  // 発行フォームの選択肢に出さない（サーバーの /api/keys/user も同じ条件で断る）。
  // 一覧のプロジェクト名の表示には、全部の所属（spaces）をそのまま使う
  const selectableSpaces = useMemo(() => spaces.filter((s) => isInternalSpaceRole(s.role)), [spaces])

  // 鍵の組織は選んだプロジェクトの組織になる（サーバー側の判定と合わせる）ため、
  // 選択肢は組織ごとに見出しで分け、1つの組織のプロジェクトだけを選べるようにする
  const selectableSpacesByOrg = useMemo(() => {
    const groups = new Map<string, { orgId: string; orgName: string; spaces: typeof selectableSpaces }>()
    for (const space of selectableSpaces) {
      const group = groups.get(space.orgId)
      if (group) {
        group.spaces.push(space)
      } else {
        groups.set(space.orgId, { orgId: space.orgId, orgName: space.orgName, spaces: [space] })
      }
    }
    return Array.from(groups.values())
  }, [selectableSpaces])
  const spaceOrgById = useMemo(
    () => new Map(selectableSpaces.map((s) => [s.id, s.orgId])),
    [selectableSpaces]
  )

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


  // Filter state
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [searchQuery, setSearchQuery] = useState('')

  const userApiKeysQueryKey = useMemo(() => ['userApiKeys', user?.id] as const, [user?.id])

  const {
    data: apiKeys = [],
    isPending: loading,
    error: queryError,
  } = useQuery<ApiKey[]>({
    queryKey: userApiKeysQueryKey,
    queryFn: async () => {
      const response = await fetch(`/api/keys/user`)
      const result = await response.json()
      if (!response.ok) throw new Error(result.error)
      return result.data || []
    },
    enabled: !!user,
  })
  const error = queryError ? 'APIキーの取得に失敗しました' : null

  // アカウントのAPIキー一覧（['userApiKeys', userId]）と、プロジェクト設定のAPI設定タブが持つ
  // プロジェクト別の一覧（['apiKeys', orgId, spaceId]）は同じ鍵を別のキャッシュで持つため、
  // 片方だけ取り直すと最大 staleTime（既定2分）ずれる。発行・削除のたびに両方取り直す
  const invalidateApiKeys = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: userApiKeysQueryKey }),
      queryClient.invalidateQueries({ queryKey: ['apiKeys'] }),
    ])

  const filteredKeys = useMemo(() => {
    return apiKeys.filter((key) => {
      if (statusFilter === 'active' && !key.is_active) return false
      if (statusFilter === 'inactive' && key.is_active) return false
      if (searchQuery.trim() && !key.name.toLowerCase().includes(searchQuery.trim().toLowerCase())) return false
      return true
    })
  }, [apiKeys, statusFilter, searchQuery])

  const handleCreate = async () => {
    if (!newKeyName.trim() || selectedSpaces.length === 0) return
    setCreating(true)
    try {
      if (!user) throw new Error('認証が必要です')

      // キーの本体はサーバー側で作る（画面では作らない）。応答に一度だけ平文が入る
      const response = await fetch('/api/keys/user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newKeyName.trim(),
          allowedSpaceIds: selectedSpaces,
          allowedActions,
        }),
      })

      const result = await response.json()
      if (!response.ok) {
        // 400は画面側で防ぎきれなかった入力の問題なので、理由を日本語で伝える。
        // それ以外（401/403/500等）は決まった一般文言のまま
        toast.error(
          response.status === 400
            ? describeApiKeyCreateError(typeof result.error === 'string' ? result.error : undefined)
            : 'APIキーの作成に失敗しました'
        )
        return
      }
      // サーバーから平文キーを受け取れていなければ、入力欄を空にする前に失敗として扱う
      // （消してしまうと、キーを画面に出せないまま入力し直しもできなくなる）
      if (typeof result.key !== 'string' || !result.key) {
        throw new Error('サーバーからキーを受け取れませんでした')
      }

      // Show the key (only once)
      setNewlyCreatedKey(result.key)
      setNewKeyName('')
      setSelectedSpaces([])
      setAllowedActions(['read'])
      setShowCreateForm(false)
      await invalidateApiKeys()
    } catch (err) {
      console.error('Failed to create API key:', err)
      toast.error('APIキーの作成に失敗しました')
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id: string) => {
    const ok = await confirm({
      title: 'APIキーを削除',
      message: 'このAPIキーを削除しますか？この操作は取り消せません。',
      confirmLabel: '削除',
      variant: 'danger',
    })
    if (!ok) return
    try {
      const response = await fetch(`/api/keys/user?id=${id}`, { method: 'DELETE' })
      const result = await response.json()

      if (!response.ok) throw new Error(result.error)
      await invalidateApiKeys()
      toast.success('APIキーを削除しました')
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

  const toggleSpace = (spaceId: string) => {
    setSelectedSpaces((prev) => {
      if (prev.includes(spaceId)) {
        return prev.filter((id) => id !== spaceId)
      }
      const currentOrgId = prev.length > 0 ? spaceOrgById.get(prev[0]) : undefined
      const targetOrgId = spaceOrgById.get(spaceId)
      // 別の組織のプロジェクトを選んだら、前の組織の選択は外す（鍵の組織は1つに決まる）。
      // 今の選択の組織が分からない（選択肢から消えた等で spaceOrgById に無い）場合も、
      // 別の組織の space が紛れ込まないよう素通しで足さず、新しい1件に置き換える
      if (!currentOrgId || targetOrgId !== currentOrgId) {
        return [spaceId]
      }
      return [...prev, spaceId]
    })
  }

  // 開いている間に一覧が取り直され、選んでいた space が選択肢（selectableSpaces）から
  // 消えたとき（役割が変わった・space から外れた等）は、選択からも外す。フィルタで
  // 減らすだけ（足さない）ので、別の組織の space が混ざることはない。
  useEffect(() => {
    const validIds = new Set(selectableSpaces.map((s) => s.id))
    setSelectedSpaces((prev) => {
      const next = prev.filter((id) => validIds.has(id))
      return next.length === prev.length ? prev : next
    })
  }, [selectableSpaces])

  const toggleAction = (action: string) => {
    setAllowedActions((prev) => {
      if (action === 'read') return prev // read is always required
      return prev.includes(action) ? prev.filter((a) => a !== action) : [...prev, action]
    })
  }

  // この組織のプロジェクトだけを全部選ぶ（別の組織を選んでいた場合はそちらを外す）
  const selectAllInOrg = (orgId: string) => {
    setSelectedSpaces(
      selectableSpaces.filter((s) => s.orgId === orgId).map((s) => s.id)
    )
  }

  const deselectAllSpaces = () => {
    setSelectedSpaces([])
  }

  // ページ全体の待ちはログイン確認（userLoading）だけにする。プロジェクト一覧（spacesLoading）は
  // 「アクセス許可するプロジェクト」欄とキー一覧のプロジェクト名表示だけが使う値なので、
  // そこだけ個別に待たせ、鍵一覧自体は spaces を待たずに出す。
  if (userLoading) {
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
      {ConfirmDialog}
      {/* Header */}
      <header className="bg-surface border-b border-gray-200">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <SettingsBackButton fallbackHref="/settings/account" />
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
            <div className="bg-surface rounded-xl p-6 max-w-lg w-full mx-4 shadow-xl">
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
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  閉じる
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Create form */}
        {showCreateForm ? (
          <div className="bg-surface rounded-lg border border-gray-200 p-6 space-y-5">
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
                <button
                  type="button"
                  onClick={deselectAllSpaces}
                  className="text-xs text-gray-500 hover:text-gray-700"
                >
                  すべて解除
                </button>
              </div>
              <p className="text-xs text-gray-500 mb-2">
                1つの組織のプロジェクトだけを選べます。別の組織のプロジェクトを選ぶと、これまでの選択は外れます
              </p>
              <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-64 overflow-y-auto">
                {spacesLoading ? (
                  <div className="px-4 py-3 text-sm text-gray-500">
                    読み込み中...
                  </div>
                ) : spaces.length === 0 ? (
                  <div className="px-4 py-3 text-sm text-gray-500">
                    所属しているプロジェクトがありません
                  </div>
                ) : selectableSpaces.length === 0 ? (
                  <div className="px-4 py-3 text-sm text-gray-500">
                    APIキーは社内メンバー向けの機能です。相手先として参加しているプロジェクトでは発行できません
                  </div>
                ) : (
                  selectableSpacesByOrg.map((group) => (
                    <div key={group.orgId}>
                      <div className="flex items-center justify-between px-4 py-1.5 bg-gray-50">
                        <span className="text-xs font-medium text-gray-500">{group.orgName}</span>
                        <button
                          type="button"
                          onClick={() => selectAllInOrg(group.orgId)}
                          className="text-xs text-indigo-600 hover:text-indigo-700"
                        >
                          この組織を全部選択
                        </button>
                      </div>
                      {group.spaces.map((space) => (
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
                          </div>
                          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">
                            {space.role}
                          </span>
                        </label>
                      ))}
                    </div>
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
                {API_KEY_ACTION_OPTIONS.map((action) => (
                  <button
                    key={action.value}
                    type="button"
                    onClick={() => toggleAction(action.value)}
                    disabled={action.required}
                    className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
                      allowedActions.includes(action.value)
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-ink'
                        : 'border-gray-200 bg-surface text-gray-600 hover:bg-gray-50'
                    } ${action.required ? 'cursor-not-allowed' : ''}`}
                    title={action.description}
                  >
                    {action.label}
                    {action.required && (
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
            className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium text-indigo-ink bg-surface border border-indigo-200 hover:bg-indigo-50 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            新しいAPIキーを作成
          </button>
        )}

        {/* API keys list */}
        <div className="bg-surface rounded-lg border border-gray-200">
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="font-medium text-gray-900 flex items-center gap-2">
              <Key className="text-gray-500" />
              発行済みAPIキー
            </h3>
          </div>

          {/* Filter bar */}
          {!loading && apiKeys.length > 0 && (
            <div className="px-4 py-2 border-b border-gray-100 flex items-center gap-2">
              {/* Search */}
              <div className="relative flex-1 max-w-xs">
                <MagnifyingGlass className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
                  placeholder="キー名で検索"
                  className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
              {/* Status pills */}
              <div className="flex items-center gap-1">
                {([
                  { value: 'all', label: 'All' },
                  { value: 'active', label: '有効' },
                  { value: 'inactive', label: '無効' },
                ] as const).map((pill) => (
                  <button
                    key={pill.value}
                    type="button"
                    onClick={() => setStatusFilter(pill.value)}
                    className={`px-2 py-1 text-[11px] rounded-md border transition-colors ${
                      statusFilter === pill.value
                        ? 'border-indigo-200 bg-indigo-50 text-indigo-ink'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {pill.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {loading ? (
            <div className="px-4 py-8 text-center text-sm text-gray-500">
              読み込み中...
            </div>
          ) : apiKeys.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-500">
              APIキーはまだ作成されていません
            </div>
          ) : filteredKeys.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-500">
              フィルター条件に一致するキーはありません
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {filteredKeys.map((key) => (
                <div key={key.id} className="px-4 py-3 hover:bg-gray-50">
                  <div className="flex items-start gap-3">
                    <Key className="text-gray-400 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900">{key.name}</span>
                        {!key.is_active && (
                          <span className="text-xs text-red-700 bg-red-50 px-1.5 py-0.5 rounded">
                            無効
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 font-mono mt-0.5">
                        {key.key_prefix}
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-xs text-gray-500">
                        <span>
                          プロジェクト: {spacesLoading ? '読み込み中...' : describeKeySpaces(key, spaces)}
                        </span>
                        <span>
                          操作: {formatApiKeyActions(key.allowed_actions)}
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

        {/* CLI のインストール → ログイン → AI に覚えさせる（プロジェクト設定の API設定 と同じ部品） */}
        <CliSetupGuide />
      </main>
    </div>
  )
}
