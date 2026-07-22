'use client'

import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { useConnectors, useCreateTaskSyncConnection } from '@/lib/hooks/useConnectors'
import { getIntegration } from '@/lib/integrations/registry'
import { parseKintoneAppUrl, parseKintoneSubdomainInput } from '@/lib/task-sync/providers/kintone/appUrl'
import { MAX_API_TOKENS_PER_REQUEST } from '@/lib/task-sync/providers/kintone/client'
import { ImportConfigEditor } from '@/components/secretary/integrations/ConnectorSyncPane'
import { KintoneAppsPanel } from '@/components/secretary/integrations/KintoneAppsPanel'
import { KintoneAppUpdateReminder } from '@/components/secretary/integrations/KintoneAppUpdateReminder'

interface KintoneConnectPanelProps {
  orgId: string
}

/**
 * kintone専用の接続パネル — TaskSyncConnectPanel(汎用。APIキー1本+接続先URL)を流用できない
 * 唯一のツール。kintoneのAPIトークンはアプリ単位で発行されるため、接続作成そのものに
 * 「サブドメイン1つ＋アプリ(URL/ID＋トークン)を複数行」を入力させる必要がある
 * (IntegrationsConsoleClient.tsx が selectedId==='kintone' のときこちらを描画する。
 * generic_inbound が ConnectorSyncPane ではなく専用の GenericInboundPanel を持つのと同じ理由)。
 *
 * モーダル禁止。接続作成は「明示的に確定する」性質の操作のため保存ボタン(「接続する」)を持つ
 * (CLAUDE.mdの「保存ボタン無し」の例外。TaskSyncConnectPanelの接続フォームと同じ扱い)。
 * amberはクライアント可視要素専用のためここでは使わない(秘書内部専用画面・クライアント非到達)。
 */
export function KintoneConnectPanel({ orgId }: KintoneConnectPanelProps) {
  const { connections, viewerRole, isLoading } = useConnectors(orgId)
  const canManage = viewerRole === 'owner' || viewerRole === 'admin'
  const def = getIntegration('kintone')
  const connection = connections.find((c) => c.provider === 'kintone') ?? null

  if (isLoading) {
    return (
      <section data-testid="kintone-connect-panel-skeleton" className="p-4">
        <div className="h-3 w-24 bg-gray-100 rounded animate-pulse mb-2" />
        <div className="h-8 w-full max-w-sm bg-gray-100 rounded animate-pulse" />
      </section>
    )
  }

  if (!def) return null

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 max-w-2xl">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-gray-900">{def.label}</h2>
      </div>
      {def.notes && <p className="mb-3 text-[11px] text-gray-400 leading-relaxed">{def.notes}</p>}

      {connection ? (
        <div className="space-y-4">
          {connection.baseUrl && <p className="text-xs text-gray-700 break-all">{connection.baseUrl}</p>}
          <ImportConfigEditor orgId={orgId} connection={connection} canManage={canManage} />
          <KintoneAppsPanel orgId={orgId} connection={connection} canManage={canManage} />
        </div>
      ) : (
        <KintoneConnectForm orgId={orgId} canManage={canManage} />
      )}
    </div>
  )
}

interface KintoneAppRow {
  key: number
  input: string
  token: string
}

function makeEmptyRow(key: number): KintoneAppRow {
  return { key, input: '', token: '' }
}

interface KintoneConnectFormProps {
  orgId: string
  canManage: boolean
}

function KintoneConnectForm({ orgId, canManage }: KintoneConnectFormProps) {
  const createConnection = useCreateTaskSyncConnection()
  const [subdomainInput, setSubdomainInput] = useState('')
  // 行のkeyは追加順に単調増加させる(indexをkeyにすると削除時に他行のinput/tokenの対応が
  // ずれてフォーカスや内部stateの取り違えが起きうるため)。
  const nextKeyRef = useRef(1)
  const [rows, setRows] = useState<KintoneAppRow[]>([makeEmptyRow(0)])

  if (!canManage) {
    return <p className="text-[11px] text-gray-400">まだ接続がありません(owner/adminのみ接続できます)</p>
  }

  const addRow = () => {
    setRows((prev) => (prev.length >= MAX_API_TOKENS_PER_REQUEST ? prev : [...prev, makeEmptyRow(nextKeyRef.current++)]))
  }
  const removeRow = (key: number) => {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== key) : prev))
  }
  const updateRow = (key: number, patch: Partial<Pick<KintoneAppRow, 'input' | 'token'>>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  const parsedAppIds = rows.map((r) => {
    const parsed = r.input.trim() ? parseKintoneAppUrl(r.input) : null
    return parsed?.ok ? parsed.data.appId : null
  })
  const nonNullAppIds = parsedAppIds.filter((id): id is string => id !== null)
  const hasDuplicateAppIds = new Set(nonNullAppIds).size !== nonNullAppIds.length

  const subdomainResult = subdomainInput.trim() ? parseKintoneSubdomainInput(subdomainInput) : null

  const canSubmit =
    !!subdomainResult?.ok &&
    rows.length <= MAX_API_TOKENS_PER_REQUEST &&
    !hasDuplicateAppIds &&
    rows.every((r) => {
      const parsed = r.input.trim() ? parseKintoneAppUrl(r.input) : null
      return !!parsed?.ok && r.token.trim().length > 0
    })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit || !subdomainResult?.ok) return

    const items = rows.map((r) => {
      const parsed = parseKintoneAppUrl(r.input)
      return parsed.ok ? { appId: parsed.data.appId, token: r.token.trim() } : null
    })
    if (items.some((item) => item === null)) return
    const validItems = items as { appId: string; token: string }[]

    try {
      await createConnection.mutateAsync({
        orgId,
        provider: 'kintone',
        apiKey: validItems.map((item) => item.token).join(','),
        baseUrl: subdomainResult.baseUrl,
        providerConfig: { kintone_app_ids: validItems.map((item) => item.appId) },
      })
      // トークンを画面/DOMに残さない(接続後はstateから消す)。
      setRows([makeEmptyRow(nextKeyRef.current++)])
      setSubdomainInput('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '接続に失敗しました')
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3 max-w-md">
      <KintoneAppUpdateReminder />

      <div>
        <label htmlFor="kintone-subdomain" className="block text-xs font-medium text-gray-700 mb-1">
          サブドメイン
        </label>
        <input
          id="kintone-subdomain"
          type="text"
          value={subdomainInput}
          onChange={(e) => setSubdomainInput(e.target.value)}
          placeholder="your-company（または https://your-company.cybozu.com）"
          className="w-full h-8 rounded-md border border-gray-200 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        {subdomainInput.trim().length > 0 && subdomainResult && !subdomainResult.ok && (
          <p className="mt-1 text-[11px] text-red-600">{subdomainResult.reason}</p>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-gray-700">アプリ</p>
        {rows.map((row) => {
          const parsed = row.input.trim() ? parseKintoneAppUrl(row.input) : null
          return (
            <div key={row.key} className="rounded-md border border-gray-200 p-2 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={row.input}
                  onChange={(e) => updateRow(row.key, { input: e.target.value })}
                  placeholder="アプリのURL または アプリID"
                  aria-label="アプリのURLまたはアプリID"
                  className="flex-1 h-8 rounded-md border border-gray-200 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                {rows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeRow(row.key)}
                    className="text-[11px] text-gray-400 hover:text-red-600 transition-colors flex-shrink-0"
                  >
                    削除
                  </button>
                )}
              </div>
              <input
                type="password"
                value={row.token}
                onChange={(e) => updateRow(row.key, { token: e.target.value })}
                placeholder="APIトークン"
                autoComplete="off"
                aria-label="APIトークン"
                className="w-full h-8 rounded-md border border-gray-200 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              {row.input.trim().length > 0 && parsed && !parsed.ok && (
                <p className="text-[11px] text-red-600">{parsed.reason}</p>
              )}
            </div>
          )
        })}
        {hasDuplicateAppIds && <p className="text-[11px] text-red-600">同じアプリを複数の行に指定できません</p>}
        <button
          type="button"
          onClick={addRow}
          disabled={rows.length >= MAX_API_TOKENS_PER_REQUEST}
          className="text-xs text-indigo-600 hover:text-indigo-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          + アプリを追加（最大{MAX_API_TOKENS_PER_REQUEST}件）
        </button>
      </div>

      <button
        type="submit"
        disabled={!canSubmit || createConnection.isPending}
        className="h-8 rounded-md px-3 text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {createConnection.isPending ? '接続中...' : '接続する'}
      </button>
    </form>
  )
}
