'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Plug, Trash, CircleNotch } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { useConfirmDialog, SettingsBackButton } from '@/components/shared'

/**
 * 外部チャット（ChatGPT など）との接続の一覧と解除。
 *
 * 同意画面で「接続はいつでも解除できます」と約束しているので、この画面が要る。
 * 自分の接続と、自分がオーナーの組織の接続が見える。
 */
interface Connection {
  id: string
  name: string
  orgName: string
  canWrite: boolean
  createdAt: string
  lastUsedAt: string | null
  isMine: boolean
  ownerName: string | null
}

function formatDate(iso: string | null): string {
  if (!iso) return '未使用'
  return new Date(iso).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })
}

export default function ConnectionsSettingsPage() {
  const { confirm, ConfirmDialog } = useConfirmDialog()
  const queryClient = useQueryClient()
  const [revoking, setRevoking] = useState<string | null>(null)

  const { data, isLoading } = useQuery<{ connections: Connection[] }>({
    queryKey: ['oauthConnections'],
    queryFn: async () => {
      const res = await fetch('/api/oauth/connections')
      if (!res.ok) throw new Error('接続を読み込めませんでした')
      return res.json()
    },
    staleTime: 30_000,
  })

  const connections = data?.connections ?? []

  async function handleRevoke(conn: Connection) {
    const ok = await confirm({
      title: '接続を解除しますか？',
      message: `「${conn.name}」からは、これ以降 AgentPM の中身が見えなくなります。もう一度使うときは、つなぎ先でやり直してください。`,
      confirmLabel: '解除する',
      variant: 'danger',
    })
    if (!ok) return

    setRevoking(conn.id)
    try {
      const res = await fetch(`/api/oauth/connections/${conn.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error || '解除できませんでした')
      toast.success('接続を解除しました')
      queryClient.invalidateQueries({ queryKey: ['oauthConnections'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '解除できませんでした')
    } finally {
      setRevoking(null)
    }
  }

  return (
    <div className="p-6 max-w-3xl">
      <SettingsBackButton />

      <div className="mt-4">
        <h1 className="text-xl font-semibold text-gray-900">外部チャットとの接続</h1>
        <p className="mt-2 text-sm text-gray-600">
          ChatGPT などのチャットから AgentPM を使えるようにした接続の一覧です。心当たりのない接続は解除してください。
        </p>
      </div>

      {isLoading ? (
        <div className="mt-8 flex items-center gap-2 text-sm text-gray-500">
          <CircleNotch className="animate-spin" size={16} />
          読み込んでいます
        </div>
      ) : connections.length === 0 ? (
        <div className="mt-8 rounded-lg border border-gray-200 bg-surface p-8 text-center">
          <Plug size={32} className="mx-auto text-gray-400" />
          <p className="mt-3 text-sm text-gray-600">まだ接続はありません。</p>
          <p className="mt-1 text-xs text-gray-500">
            つなぎ先のアプリ側で AgentPM を追加すると、ここに出ます。
          </p>
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {connections.map((conn) => (
            <li key={conn.id} className="rounded-lg border border-gray-200 bg-surface p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 break-all">{conn.name}</p>
                  <p className="mt-1 text-xs text-gray-500">
                    {conn.orgName}
                    {' ・ '}
                    {conn.canWrite ? '見る＋書く' : '見るだけ'}
                    {!conn.isMine && conn.ownerName ? ` ・ ${conn.ownerName} が許可` : ''}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    許可した日: {formatDate(conn.createdAt)} ・ 最後に使われた日: {formatDate(conn.lastUsedAt)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRevoke(conn)}
                  disabled={revoking === conn.id}
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 disabled:opacity-50"
                >
                  {revoking === conn.id ? <CircleNotch className="animate-spin" size={14} /> : <Trash size={14} />}
                  解除
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {ConfirmDialog}
    </div>
  )
}
