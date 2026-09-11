'use client'

import { useState, useMemo, useContext, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Key, Plus, Trash, Copy, Check, Eye, EyeSlash, Warning } from '@phosphor-icons/react'
import Link from 'next/link'
import { toast } from 'sonner'
import { CliSetupGuide } from '@/components/settings/CliSetupGuide'
import { API_KEY_ACTION_OPTIONS, formatApiKeyActions } from '@/lib/api-keys/actionOptions'
import { useCurrentUser } from '@/lib/hooks/useCurrentUser'
import { useSpaceMembers } from '@/lib/hooks/useSpaceMembers'
import { ActiveOrgContext } from '@/lib/org/ActiveOrgProvider'

interface ApiKey {
  id: string
  name: string
  key_prefix: string
  created_at: string
  last_used_at: string | null
  expires_at: string | null
  is_active: boolean
  allowed_actions: string[]
  /** 鍵の持ち主。空なら持ち主を記録する前（〜2026-09）の古い鍵で、CLI では必ず断られる */
  user_id: string | null
}

interface ApiSettingsProps {
  orgId: string
  spaceId: string
}

/** GET /api/keys が非2xxを返したときの状態付きエラー。403のときだけ spaceMembers を取り直す判定などに使う */
class ApiKeysFetchError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiKeysFetchError'
    this.status = status
  }
}

function isClientError(error: unknown): boolean {
  return error instanceof ApiKeysFetchError && error.status >= 400 && error.status < 500
}

export function ApiSettings({ orgId, spaceId }: ApiSettingsProps) {
  const queryClient = useQueryClient()
  const { user } = useCurrentUser()
  const ctx = useContext(ActiveOrgContext)
  // 組織の役割（org owner かどうかの判定用）。ユーザーは複数組織に所属し得るため、
  // 「いま選んでいる組織」1件だけでなく、ActiveOrgContext が持つ所属組織の一覧（orgs）から
  // URLのorgIdに一致する行を探す（このプロジェクトのorgIdは、必ずしも「いま選んでいる組織」と
  // 一致するとは限らない）。
  const orgRole = ctx.orgs.find((o) => o.orgId === orgId)?.role ?? null
  const { members, isPending: membersPending } = useSpaceMembers(spaceId)

  const spaceRole = useMemo(
    () => members.find((m) => m.id === user?.id)?.role ?? null,
    [members, user]
  )

  // 管理者＝組織の owner、または このプロジェクトの admin（サーバー側の判定条件と同じ。変えないこと）
  const isAdmin = orgRole === 'owner' || spaceRole === 'admin'
  // まだ管理者と分かっていない間だけ「確認中」。所属組織一覧がネットワークで一度も確認できていない
  // (orgsStatus: 'unknown') 間はキャッシュも無いので確定できず「確認中」を出す。
  // 'cached'（IDB永続キャッシュから復元済み）なら、そのまま orgRole を信用して即座に出す
  const checkingRole = !isAdmin && (ctx.orgsStatus === 'unknown' || membersPending)

  // New key form
  const [newKeyName, setNewKeyName] = useState('')
  // この画面の鍵は CLI / AI からこのプロジェクトを操作するためのもの。読み取りだけだと
  // いちばんよく使うタスク作成で必ず断られるので、書き込みまでを初期値にする（外すこともできる）
  const [allowedActions, setAllowedActions] = useState<string[]>(['read', 'write'])
  const [creating, setCreating] = useState(false)

  // Newly created key (shown once)
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [showKey, setShowKey] = useState(false)

  const keysQueryKey = useMemo(() => ['apiKeys', orgId, spaceId] as const, [orgId, spaceId])

  const {
    data: apiKeysData,
    isPending: keysPending,
    error: keysError,
  } = useQuery<ApiKey[]>({
    queryKey: keysQueryKey,
    queryFn: async () => {
      const response = await fetch(`/api/keys?orgId=${orgId}&spaceId=${spaceId}`)
      const result = await response.json()
      if (!response.ok) throw new ApiKeysFetchError(result.error || 'APIキーの取得に失敗しました', response.status)
      return result.data || []
    },
    enabled: isAdmin,
    // 4xx（権限が無くなった等）は状況が変わらない限り何度再試行しても同じ結果になるだけなので試行しない
    retry: (failureCount, error) => (isClientError(error) ? false : failureCount < 1),
  })
  const apiKeys = apiKeysData ?? []
  // データを一度も取れていない（初回失敗）ときだけ全面エラーにする。取得済みのキャッシュがあれば
  // 裏の取り直しが失敗しても一覧はそのまま出し続ける（新規発行直後のモーダルもここで消さない）
  const hasCachedKeys = apiKeysData !== undefined
  const keysFatalError = !!keysError && !hasCachedKeys

  // 403（権限が無い）を受けたら、キャッシュ済みの role が古くなっている可能性が高いので取り直す。
  // space の役割（spaceMembers）だけでなく、org owner かどうかも今は永続キャッシュされた
  // orgMemberships 由来なので、そちらも合わせて取り直す。次のレンダーで isAdmin が false に
  // 変われば、この画面自体が「管理者のみ」表示に切り替わる
  useEffect(() => {
    if (keysError instanceof ApiKeysFetchError && keysError.status === 403) {
      void queryClient.invalidateQueries({ queryKey: ['spaceMembers', spaceId] })
      void queryClient.invalidateQueries({ queryKey: ['orgMemberships'] })
    }
  }, [keysError, queryClient, spaceId])

  // このプロジェクトの鍵一覧（['apiKeys', orgId, spaceId]）と、アカウントのAPIキー一覧
  // （['userApiKeys', userId]、/settings/api-keys が表示）は同じ鍵を別のキャッシュで持つため、
  // 片方だけ取り直すと最大 staleTime（既定2分）ずれる。発行・削除のたびに両方取り直す
  const invalidateRelatedCaches = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: keysQueryKey }),
      queryClient.invalidateQueries({ queryKey: ['userApiKeys'] }),
    ])

  const handleCreate = async () => {
    if (!newKeyName.trim() || !user?.id) return
    setCreating(true)
    try {
      // キーの本体はサーバー側で作る（画面では作らない）。応答に一度だけ平文が入る。
      // Use API route to bypass RLS (userId is extracted from session server-side)
      const response = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          spaceId,
          name: newKeyName.trim(),
          allowedActions,
        }),
      })

      const result = await response.json()
      if (!response.ok) throw new Error(result.error)
      // サーバーから平文キーを受け取れていなければ、入力欄を空にする前に失敗として扱う
      // （消してしまうと、キーを画面に出せないまま入力し直しもできなくなる）
      if (typeof result.key !== 'string' || !result.key) {
        throw new Error('サーバーからキーを受け取れませんでした')
      }

      // Show the key (only once)
      setNewlyCreatedKey(result.key)
      setNewKeyName('')
      await invalidateRelatedCaches()
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
      const response = await fetch(`/api/keys?id=${id}&orgId=${orgId}`, { method: 'DELETE' })
      const result = await response.json()

      if (!response.ok) throw new Error(result.error)
      await invalidateRelatedCaches()
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

  const toggleAction = (action: string) => {
    if (action === 'read') return // 読み取りは全キーに必須
    setAllowedActions((prev) => (prev.includes(action) ? prev.filter((a) => a !== action) : [...prev, action]))
  }

  // 一度きりの新規鍵の表示は、下の本体（確認中・権限なし・読み込み中・エラー等）の
  // どの状態に切り替わっても消えないよう、本体とは別に常に評価する
  function renderNewKeyModal() {
    if (!newlyCreatedKey) return null
    return (
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
          <p className="mt-4 text-xs text-gray-500">
            次は、下の「AI（Claude Code など）から使う準備」の手順2で、このキーを登録します。
          </p>
          <div className="mt-6 flex justify-end">
            <button
              onClick={closeNewKeyModal}
              className="h-8 rounded-md px-3 text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-500 transition-colors"
            >
              閉じる
            </button>
          </div>
        </div>
      </div>
    )
  }

  function renderBody() {
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
          </p>
        </div>
      )
    }

    if (keysPending) {
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

    // 一度も取得できていない（初回から失敗）ときだけ全面エラー。裏の取り直し失敗は下の帯で知らせる
    if (keysFatalError) {
      return (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-gray-700">
            <Key className="text-lg" />
            <h3 className="font-medium">API設定</h3>
          </div>
          <div className="p-4 text-sm text-red-600">
            APIキーの取得に失敗しました
          </div>
        </div>
      )
    }

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-gray-700">
          <Key className="text-lg" />
          <h3 className="font-medium">API設定</h3>
          <span className="text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded">管理者限定</span>
        </div>

        <p className="text-sm text-gray-500">
          AI（Claude Code など）や CLI から、このプロジェクトを操作するための APIキーを発行します。
        </p>

        {keysError && (
          <div className="px-3 py-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg">
            最新の一覧の取得に失敗しました。前回取得できた一覧を表示しています。
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
                  {key.user_id ? (
                    <div className="text-xs text-gray-500 mt-0.5">
                      {formatApiKeyActions(key.allowed_actions ?? [])}
                    </div>
                  ) : (
                    <div className="text-xs text-red-600 mt-0.5">
                      CLI では使えない古い形式のキーです。削除して発行し直してください
                    </div>
                  )}
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
        <div className="border border-gray-200 rounded-lg p-4 space-y-3">
          <div className="text-xs font-medium text-gray-500">
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
              className="flex items-center gap-1 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
            >
              <Plus className="text-sm" />
              {creating ? '作成中...' : '発行'}
            </button>
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1.5">許可する操作</div>
            <div className="flex flex-wrap gap-2">
              {API_KEY_ACTION_OPTIONS.map((action) => (
                <button
                  key={action.value}
                  type="button"
                  onClick={() => toggleAction(action.value)}
                  disabled={action.required}
                  aria-pressed={allowedActions.includes(action.value)}
                  title={action.description}
                  className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                    allowedActions.includes(action.value)
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-ink'
                      : 'border-gray-200 bg-surface text-gray-600 hover:bg-gray-50'
                  } ${action.required ? 'cursor-not-allowed' : ''}`}
                >
                  {action.label}
                  {action.required && <span className="ml-1 text-gray-400">(必須)</span>}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-gray-400">
              このプロジェクトだけで使えるキーです。操作は、キーを作ったあなたの権限の範囲で行われます。
              複数のプロジェクトで使うキーは
              <Link href="/settings/api-keys" className="text-indigo-ink hover:underline">アカウントのAPIキー</Link>
              で作れます。
            </p>
          </div>
        </div>

        {/* CLI のインストール → ログイン → AI に覚えさせる（以前はここに旧MCP向けの .env.local の見本だけがあった） */}
        <CliSetupGuide spaceId={spaceId} />
      </div>
    )
  }

  return (
    <>
      {renderNewKeyModal()}
      {renderBody()}
    </>
  )
}
