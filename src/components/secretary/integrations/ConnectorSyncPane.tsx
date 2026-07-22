'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { useConfirmDialog } from '@/components/shared'
import {
  useConnectors,
  useCreateMulticaConnection,
  useRotateMulticaSecret,
  useUpdateImportConfig,
  type ConnectorConnection,
  type ConnectorImportConfig,
  type ConnectorSecretDirection,
  type CreateMulticaConnectionResult,
  type RotateMulticaSecretResult,
} from '@/lib/hooks/useConnectors'
import { useUserSpaces } from '@/lib/hooks/useUserSpaces'
import { useSpaceMembers } from '@/lib/hooks/useSpaceMembers'
import { pruneImportConfig } from '@/lib/integrations/importConfig'
import { SecretReveal } from '@/components/secretary/integrations/SecretReveal'
import { MulticaConnectionReveal } from '@/components/secretary/integrations/MulticaConnectionReveal'

interface ConnectorSyncPaneProps {
  orgId: string
}

/**
 * ステータスのバッジ色。sink用statusPill.tsxはintegration_sinks(active/disabled/error)専用のため
 * ここでは触らず、integration_connections(active/expired/revoked)用に別途持つ
 * (amberはクライアント可視要素専用のため使わない=このコンソールはクライアントに到達しない)。
 */
const CONNECTOR_STATUS_LABEL: Record<string, string> = {
  active: '有効',
  expired: '期限切れ',
  revoked: '無効化済み',
}
const CONNECTOR_STATUS_CLASS: Record<string, string> = {
  active: 'bg-green-50 text-green-700',
  expired: 'bg-gray-100 text-gray-500',
  revoked: 'bg-red-50 text-red-600',
}

/** TaskSyncConnectPanel(backlog等)とも共有するためexport(重複実装しない)。 */
export function ConnectorStatusPill({ status }: { status: string }) {
  return (
    <span
      className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${
        CONNECTOR_STATUS_CLASS[status] ?? 'bg-gray-100 text-gray-500'
      }`}
    >
      {CONNECTOR_STATUS_LABEL[status] ?? status}
    </span>
  )
}

/**
 * 双方向同期(multica/gtasks)の接続管理UI。docs/spec/MULTICA_CONNECTOR_CONTRACT.md。
 * モーダル禁止・保存ボタン禁止(optimistic update)。amberはクライアント可視要素専用のため
 * ここでは使わない(このコンソールは秘書内部専用画面でクライアントは到達しない)。
 * 左のsink一覧(SinkListPane)は幅が狭く2種の接続(multica作成フォーム/gtasks import設定)を
 * 収めるには窮屈なため、IntegrationsConsoleClientの2カラムsink UIの上に独立セクションとして置く。
 */
export function ConnectorSyncPane({ orgId }: ConnectorSyncPaneProps) {
  const { connections, viewerRole, isLoading } = useConnectors(orgId)
  const canManage = viewerRole === 'owner' || viewerRole === 'admin'

  const multicaConnection = connections.find((c) => c.provider === 'multica') ?? null
  const gtasksConnections = connections.filter((c) => c.provider === 'google_tasks')

  // 既定選択(google_tasks)がconnector surfaceのため、org切替直後は必ずここが最初に
  // 描画される。return null(空白)だと初回だけ詳細ペインが真っ白に見えるため、
  // 軽量スケルトンで領域を確保する(モーダル禁止・保存ボタンなしは維持)。
  if (isLoading) {
    return (
      <section
        data-testid="connector-sync-pane-skeleton"
        className="border-b border-gray-200 px-4 py-3 flex-shrink-0"
      >
        <div className="h-3 w-20 bg-gray-100 rounded animate-pulse mb-2" />
        <div className="h-2.5 w-64 bg-gray-100 rounded animate-pulse mb-3" />
        <div className="flex flex-col md:flex-row gap-3">
          <div className="flex-1 min-w-0 rounded-lg border border-gray-200 p-3 space-y-2">
            <div className="h-3 w-24 bg-gray-100 rounded animate-pulse" />
            <div className="h-8 w-full bg-gray-100 rounded animate-pulse" />
          </div>
          <div className="flex-1 min-w-0 rounded-lg border border-gray-200 p-3 space-y-2">
            <div className="h-3 w-24 bg-gray-100 rounded animate-pulse" />
            <div className="h-8 w-full bg-gray-100 rounded animate-pulse" />
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="border-b border-gray-200 px-4 py-3 flex-shrink-0">
      <div className="mb-2">
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">双方向同期</span>
        <p className="mt-1 text-[11px] text-gray-400 leading-relaxed">
          gtasks・multica と双方向に同期。完了は両側へ反映されます。
        </p>
      </div>
      <div className="flex flex-col md:flex-row gap-3">
        <MulticaBlock orgId={orgId} connection={multicaConnection} canManage={canManage} />
        <GtasksBlock orgId={orgId} connections={gtasksConnections} canManage={canManage} />
      </div>
    </section>
  )
}

interface MulticaBlockProps {
  orgId: string
  connection: ConnectorConnection | null
  canManage: boolean
}

function MulticaBlock({ orgId, connection, canManage }: MulticaBlockProps) {
  const [baseUrlDraft, setBaseUrlDraft] = useState('')
  const [justCreated, setJustCreated] = useState<CreateMulticaConnectionResult | null>(null)
  const [rotatedSecret, setRotatedSecret] = useState<RotateMulticaSecretResult | null>(null)

  const createConnection = useCreateMulticaConnection()
  const rotateSecret = useRotateMulticaSecret()
  const { confirm, ConfirmDialog } = useConfirmDialog()

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = baseUrlDraft.trim()
    if (!trimmed) return
    try {
      const result = await createConnection.mutateAsync({ orgId, baseUrl: trimmed })
      setJustCreated(result)
      setBaseUrlDraft('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'multica接続の作成に失敗しました')
    }
  }

  const handleRotate = async (direction: ConnectorSecretDirection) => {
    if (!connection) return
    const ok = await confirm({
      title: `${direction === 'send' ? '送信鍵' : '受信鍵'}を再生成しますか`,
      message: '既存の鍵は即座に無効になります。multica側の設定も新しい鍵へ更新してください。',
      confirmLabel: '再生成する',
      variant: 'danger',
    })
    if (!ok) return
    try {
      const result = await rotateSecret.mutateAsync({ orgId, connectionId: connection.id, direction })
      setRotatedSecret(result)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '鍵のローテーションに失敗しました')
    }
  }

  return (
    <div className="flex-1 min-w-0 rounded-lg border border-gray-200 p-3 space-y-2.5">
      {ConfirmDialog}
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold text-gray-900">自社multica接続</h3>
        {connection && <ConnectorStatusPill status={connection.status} />}
      </div>

      {justCreated && (
        <MulticaConnectionReveal
          webhookUrl={justCreated.webhookUrl}
          connectionId={justCreated.connectionId}
          sendSecret={justCreated.sendSecret}
          receiveSecret={justCreated.receiveSecret}
          onDismiss={() => setJustCreated(null)}
        />
      )}
      {rotatedSecret && <SecretReveal secret={rotatedSecret.secret} onDismiss={() => setRotatedSecret(null)} />}

      {!connection ? (
        canManage ? (
          <form onSubmit={(e) => void handleCreate(e)} className="space-y-2">
            <div>
              <label htmlFor="multica-base-url" className="block text-xs font-medium text-gray-700 mb-1">
                multicaのURL
              </label>
              <input
                id="multica-base-url"
                type="url"
                value={baseUrlDraft}
                onChange={(e) => setBaseUrlDraft(e.target.value)}
                placeholder="https://multica.example.com"
                className="w-full h-8 rounded-md border border-gray-200 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <button
              type="submit"
              disabled={!baseUrlDraft.trim() || createConnection.isPending}
              className="h-8 rounded-md px-3 text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {createConnection.isPending ? '作成中...' : '自社multica接続を作成'}
            </button>
          </form>
        ) : (
          <p className="text-[11px] text-gray-400">まだ接続がありません(owner/adminのみ作成できます)</p>
        )
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-gray-700 break-all">{connection.baseUrl}</p>
          {canManage && (
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => void handleRotate('send')}
                className="h-7 rounded-md px-2.5 text-xs font-medium bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 transition-colors"
              >
                送信鍵を再生成
              </button>
              <button
                type="button"
                onClick={() => void handleRotate('receive')}
                className="h-7 rounded-md px-2.5 text-xs font-medium bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 transition-colors"
              >
                受信鍵を再生成
              </button>
            </div>
          )}
          <MulticaTargetSpaceSelect orgId={orgId} connection={connection} canManage={canManage} />
        </div>
      )}
    </div>
  )
}

interface GtasksBlockProps {
  orgId: string
  connections: ConnectorConnection[]
  canManage: boolean
}

function GtasksBlock({ orgId, connections, canManage }: GtasksBlockProps) {
  if (connections.length === 0) {
    return (
      <div className="flex-1 min-w-0 rounded-lg border border-gray-200 p-3">
        <h3 className="text-xs font-semibold text-gray-900 mb-1">Google Tasks</h3>
        <p className="text-[11px] text-gray-400 leading-relaxed">
          Google Tasksとの同期はまだ接続されていません。連携メニューから接続してください。{' '}
          <a
            href={`/api/integrations/auth/google_tasks?orgId=${encodeURIComponent(orgId)}`}
            className="text-indigo-600 hover:text-indigo-800 underline"
          >
            Google Tasksに接続
          </a>
        </p>
      </div>
    )
  }

  return (
    <div className="flex-1 min-w-0 space-y-2.5">
      <h3 className="text-xs font-semibold text-gray-900">Google Tasks</h3>
      {connections.map((connection) => (
        <ImportConfigEditor key={connection.id} orgId={orgId} connection={connection} canManage={canManage} />
      ))}
    </div>
  )
}

/**
 * multica 起点タスク(契約 §4.3)の取り込み先スペースを設定する(import_config.target_space_id)。
 * multica が新規 Issue を作ると task.created で TaskApp 側に起票され、ここで指定した space に入る。
 * 未設定だと受信側(inbound)が 422 で受け付けない。保存ボタンは持たず、選択即 PATCH(optimistic)。
 */
function MulticaTargetSpaceSelect({ orgId, connection, canManage }: ImportConfigEditorProps) {
  const importConfig = connection.importConfig as ConnectorImportConfig
  const [targetSpaceId, setTargetSpaceId] = useState(importConfig.target_space_id ?? '')
  const updateImportConfig = useUpdateImportConfig()
  const { spaces } = useUserSpaces()
  const orgSpaces = spaces.filter((space) => space.orgId === orgId)

  const handleChange = async (value: string) => {
    setTargetSpaceId(value)
    const next = pruneImportConfig({ ...connection.importConfig, target_space_id: value })
    try {
      await updateImportConfig.mutateAsync({ orgId, connectionId: connection.id, importConfig: next })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '取り込み先の更新に失敗しました')
      setTargetSpaceId(importConfig.target_space_id ?? '') // hook側でキャッシュはロールバック済み
    }
  }

  return (
    <div>
      <label htmlFor={`multica-target-space-${connection.id}`} className="block text-xs font-medium text-gray-700 mb-1">
        multica起点タスクの取り込み先スペース
      </label>
      {orgSpaces.length > 0 ? (
        <select
          id={`multica-target-space-${connection.id}`}
          value={targetSpaceId}
          disabled={!canManage}
          onChange={(e) => void handleChange(e.target.value)}
          className="w-full h-8 rounded-md border border-gray-200 px-2 text-xs disabled:bg-gray-50 disabled:text-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          <option value="">未設定(multica起点の起票を受け付けない)</option>
          {orgSpaces.map((space) => (
            <option key={space.id} value={space.id}>
              {space.name}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={`multica-target-space-${connection.id}`}
          type="text"
          defaultValue={targetSpaceId}
          disabled={!canManage}
          onBlur={(e) => void handleChange(e.target.value.trim())}
          placeholder="スペースのUUID"
          className="w-full h-8 rounded-md border border-gray-200 px-2 text-xs font-mono disabled:bg-gray-50 disabled:text-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      )}
      <p className="mt-1 text-[11px] text-gray-400">
        multica が作成したタスクの入り先。未設定だと multica 起点の起票は受け付けません。
      </p>
    </div>
  )
}

export interface ImportConfigEditorProps {
  orgId: string
  connection: ConnectorConnection
  canManage: boolean
}

// pruneImportConfig は src/lib/integrations/importConfig.ts へ切り出した(NotionImportPanel.tsx と
// 共有する小さな純粋関数を、将来のcode splittingでこの大きなモジュールごと巻き込まないため)。
// 呼び出し元は両方ともそこから直接importする(このファイルはre-exportしない)。

/**
 * gtasks接続1件分のimport_configエディタ(target_space_id/read_list_ids/default_assignee_id)。
 * 保存ボタンは持たず、select onChange / text onBlurのたびに即時PATCHする(optimisticはhook側で担保)。
 * 親組織のspace/member一覧に候補が無ければUUIDテキスト入力にフォールバックし、
 * サーバ側(DBトリガー)の400/422バリデーションに委ねる。
 */
/** TaskSyncConnectPanel(backlog等)とも共有するためexport(取り込み設定UIを重複実装しない)。 */
export function ImportConfigEditor({ orgId, connection, canManage }: ImportConfigEditorProps) {
  const importConfig = connection.importConfig as ConnectorImportConfig
  const [targetSpaceId, setTargetSpaceId] = useState(importConfig.target_space_id ?? '')
  const [defaultAssigneeId, setDefaultAssigneeId] = useState(importConfig.default_assignee_id ?? '')
  const [readListIdsDraft, setReadListIdsDraft] = useState((importConfig.read_list_ids ?? []).join(', '))

  const updateImportConfig = useUpdateImportConfig()
  const { spaces } = useUserSpaces()
  const orgSpaces = spaces.filter((space) => space.orgId === orgId)
  const { internalMembers } = useSpaceMembers(targetSpaceId || null)

  const runUpdate = async (patch: Partial<ConnectorImportConfig>, importEnabled?: boolean) => {
    const nextConfig = pruneImportConfig({ ...connection.importConfig, ...patch })
    try {
      await updateImportConfig.mutateAsync({
        orgId,
        connectionId: connection.id,
        importConfig: nextConfig,
        importEnabled,
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '取り込み設定の更新に失敗しました')
      // hook側(onError)でキャッシュはロールバック済み。フォームのdraftも直前の確定値へ戻す。
      setTargetSpaceId(importConfig.target_space_id ?? '')
      setDefaultAssigneeId(importConfig.default_assignee_id ?? '')
      setReadListIdsDraft((importConfig.read_list_ids ?? []).join(', '))
    }
  }

  const handleTargetSpaceChange = (value: string) => {
    setTargetSpaceId(value)
    // 接続作成時は import_enabled=false で保存される(設定前に大量のタスクが予期しないスペースへ
    // 流れ込むのを防ぐため)。取り込み先スペースを選ぶ=まさにその設定が終わった瞬間なので、
    // ここで import_enabled も連動させる(選択=有効化・未設定に戻す=無効化)。手動トグルを
    // 別に置くと「スペースは選んだのにトグルを押し忘れて永久に同期されない」を生むため、
    // 派生値として一体で扱う。
    void runUpdate({ target_space_id: value }, !!value)
  }

  const handleAssigneeChange = (value: string) => {
    setDefaultAssigneeId(value)
    void runUpdate({ default_assignee_id: value })
  }

  const handleReadListBlur = () => {
    const ids = readListIdsDraft
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
    void runUpdate({ read_list_ids: ids })
  }

  return (
    <div className="rounded-lg border border-gray-200 p-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <ConnectorStatusPill status={connection.status} />
        <span className="text-[11px] text-gray-400">
          {connection.importEnabled ? '取り込み有効' : '取り込み無効'}
        </span>
      </div>

      <div>
        <label htmlFor={`target-space-${connection.id}`} className="block text-xs font-medium text-gray-700 mb-1">
          取り込み先スペース
        </label>
        {orgSpaces.length > 0 ? (
          <select
            id={`target-space-${connection.id}`}
            value={targetSpaceId}
            disabled={!canManage}
            onChange={(e) => handleTargetSpaceChange(e.target.value)}
            className="w-full h-8 rounded-md border border-gray-200 px-2 text-xs disabled:bg-gray-50 disabled:text-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="">未設定(取り込みskip)</option>
            {orgSpaces.map((space) => (
              <option key={space.id} value={space.id}>
                {space.name}
              </option>
            ))}
          </select>
        ) : (
          <input
            id={`target-space-${connection.id}`}
            type="text"
            defaultValue={targetSpaceId}
            disabled={!canManage}
            onBlur={(e) => handleTargetSpaceChange(e.target.value.trim())}
            placeholder="スペースのUUID"
            className="w-full h-8 rounded-md border border-gray-200 px-2 text-xs font-mono disabled:bg-gray-50 disabled:text-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        )}
      </div>

      <div>
        <label htmlFor={`default-assignee-${connection.id}`} className="block text-xs font-medium text-gray-700 mb-1">
          既定の担当者(任意)
        </label>
        {internalMembers.length > 0 ? (
          <select
            id={`default-assignee-${connection.id}`}
            value={defaultAssigneeId}
            disabled={!canManage || !targetSpaceId}
            onChange={(e) => handleAssigneeChange(e.target.value)}
            className="w-full h-8 rounded-md border border-gray-200 px-2 text-xs disabled:bg-gray-50 disabled:text-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="">指定なし</option>
            {internalMembers.map((member) => (
              <option key={member.id} value={member.id}>
                {member.displayName}
              </option>
            ))}
          </select>
        ) : (
          <input
            id={`default-assignee-${connection.id}`}
            type="text"
            defaultValue={defaultAssigneeId}
            disabled={!canManage}
            onBlur={(e) => handleAssigneeChange(e.target.value.trim())}
            placeholder="メンバーのUUID(任意)"
            className="w-full h-8 rounded-md border border-gray-200 px-2 text-xs font-mono disabled:bg-gray-50 disabled:text-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        )}
      </div>

      <div>
        <label htmlFor={`read-list-ids-${connection.id}`} className="block text-xs font-medium text-gray-700 mb-1">
          読み込み対象リスト(任意・カンマ区切り)
        </label>
        <input
          id={`read-list-ids-${connection.id}`}
          type="text"
          value={readListIdsDraft}
          disabled={!canManage}
          onChange={(e) => setReadListIdsDraft(e.target.value)}
          onBlur={handleReadListBlur}
          placeholder="list-id-1, list-id-2"
          className="w-full h-8 rounded-md border border-gray-200 px-2 text-xs disabled:bg-gray-50 disabled:text-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <p className="mt-1 text-[11px] text-gray-400">省略時はミラー出力先リスト以外の全リストが対象です</p>
      </div>
    </div>
  )
}
