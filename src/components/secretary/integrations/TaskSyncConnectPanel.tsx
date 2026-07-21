'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import {
  useConnectors,
  useCreateTaskSyncConnection,
} from '@/lib/hooks/useConnectors'
import { getIntegration, type IntegrationId } from '@/lib/integrations/registry'
import { getTaskSyncAdapter } from '@/lib/task-sync/adapters'
import { ImportConfigEditor } from '@/components/secretary/integrations/ConnectorSyncPane'

interface TaskSyncConnectPanelProps {
  orgId: string
  integrationId: IntegrationId
}

/**
 * 接続先URL欄のコピー(ツールごとに呼び名が違う。Backlog=スペースURL/Redmine=サーバーURL/
 * Jira=サイトURL)。hostPolicy.kind==='fixed'のツールはこの欄自体を出さない。
 */
const BASE_URL_COPY: Partial<Record<IntegrationId, { label: string; placeholder: string }>> = {
  backlog: { label: 'スペースURL', placeholder: 'https://your-space.backlog.jp' },
  jira: { label: 'サイトURL', placeholder: 'https://your-site.atlassian.net' },
  redmine: { label: 'サーバーURL', placeholder: 'https://redmine.example.com' },
}
const DEFAULT_BASE_URL_COPY = { label: '接続先URL', placeholder: 'https://example.com' }

/**
 * APIキー方式のタスク同期ツール(Backlog/Jooto/Jira/Redmine/Asana/Trello/Linear)接続パネル。
 * 既存接続があれば状態＋取り込み設定(ImportConfigEditorを再利用=重複実装しない)、
 * 無ければ接続フォームを出す。モーダル禁止・保存ボタン禁止(optimistic update)。
 * amberはクライアント可視要素専用のためここでは使わない(秘書内部専用画面・クライアント非到達)。
 *
 * 接続一覧は既存の useConnectors(=GET /api/integrations/connections)に相乗りする。
 * 同APIのprovider絞り込みが広がるまでは、ここで作った接続も一覧に現れる想定で実装しておき、
 * 反映され次第そのまま繋がる(hookの差し替えのみで済む設計)。
 */
export function TaskSyncConnectPanel({ orgId, integrationId }: TaskSyncConnectPanelProps) {
  const { connections, viewerRole, isLoading } = useConnectors(orgId)
  const canManage = viewerRole === 'owner' || viewerRole === 'admin'
  const def = getIntegration(integrationId)
  const adapter = getTaskSyncAdapter(integrationId)
  const connection = connections.find((c) => c.provider === integrationId) ?? null

  if (isLoading) {
    return (
      <section data-testid="task-sync-connect-panel-skeleton" className="p-4">
        <div className="h-3 w-24 bg-gray-100 rounded animate-pulse mb-2" />
        <div className="h-8 w-full max-w-sm bg-gray-100 rounded animate-pulse" />
      </section>
    )
  }

  // 呼び出し側(IntegrationsConsoleClient)が implementedTaskSyncProviders() で絞ってから
  // このパネルを出す契約のため、通常はここに来ない。防御的にnullを返す。
  if (!def || !adapter) return null

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 max-w-2xl">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-gray-900">{def.label}</h2>
      </div>
      {def.notes && <p className="mb-3 text-[11px] text-gray-400 leading-relaxed">{def.notes}</p>}

      {connection ? (
        <div className="space-y-2.5">
          {connection.baseUrl && <p className="text-xs text-gray-700 break-all">{connection.baseUrl}</p>}
          <ImportConfigEditor orgId={orgId} connection={connection} canManage={canManage} />
        </div>
      ) : (
        <TaskSyncConnectForm
          orgId={orgId}
          integrationId={integrationId}
          canManage={canManage}
          needsBaseUrl={adapter.hostPolicy.kind !== 'fixed'}
        />
      )}
    </div>
  )
}

interface TaskSyncConnectFormProps {
  orgId: string
  integrationId: IntegrationId
  canManage: boolean
  needsBaseUrl: boolean
}

function TaskSyncConnectForm({ orgId, integrationId, canManage, needsBaseUrl }: TaskSyncConnectFormProps) {
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const createConnection = useCreateTaskSyncConnection()
  const urlCopy = BASE_URL_COPY[integrationId] ?? DEFAULT_BASE_URL_COPY

  if (!canManage) {
    return <p className="text-[11px] text-gray-400">まだ接続がありません(owner/adminのみ接続できます)</p>
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await createConnection.mutateAsync({
        orgId,
        provider: integrationId,
        apiKey,
        baseUrl: needsBaseUrl ? baseUrl.trim() : undefined,
      })
      // APIキーを画面/DOMに残さない(接続後はstateから消す)。
      setApiKey('')
      setBaseUrl('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '接続に失敗しました')
    }
  }

  const canSubmit = apiKey.trim().length > 0 && (!needsBaseUrl || baseUrl.trim().length > 0)

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-2 max-w-sm">
      {needsBaseUrl && (
        <div>
          <label
            htmlFor={`task-sync-base-url-${integrationId}`}
            className="block text-xs font-medium text-gray-700 mb-1"
          >
            {urlCopy.label}
          </label>
          <input
            id={`task-sync-base-url-${integrationId}`}
            type="url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={urlCopy.placeholder}
            className="w-full h-8 rounded-md border border-gray-200 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      )}
      <div>
        <label
          htmlFor={`task-sync-api-key-${integrationId}`}
          className="block text-xs font-medium text-gray-700 mb-1"
        >
          APIキー
        </label>
        <input
          id={`task-sync-api-key-${integrationId}`}
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          autoComplete="off"
          className="w-full h-8 rounded-md border border-gray-200 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
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
