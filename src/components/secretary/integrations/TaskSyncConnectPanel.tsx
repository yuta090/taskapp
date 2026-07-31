'use client'

import { useState } from 'react'
import { ArrowSquareOut } from '@phosphor-icons/react'
import { toast } from 'sonner'
import {
  useConnectors,
  useCreateTaskSyncConnection,
  NeedsWorkspaceChoiceError,
  type WorkspaceChoice,
} from '@/lib/hooks/useConnectors'
import { getIntegration, type IntegrationId } from '@/lib/integrations/registry'
import {
  isImplementedTaskSyncProvider,
  taskSyncProviderNeedsBaseUrl,
} from '@/lib/task-sync/implemented'
import { getTrelloAuthorizeUrl } from '@/lib/trello/config'
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
 * ツール固有の追加入力欄の定義。APIキー(+接続先URL)だけでは認証が成立しないツール専用
 * （例: Jira は Basic 認証にメールアドレスが要る。src/lib/task-sync/providers/jira.ts が
 * `config.jira_email` を必須で読む）。「どのツールにどの追加入力が要るか」をここ1箇所に
 * まとめる(ツールが増えてもここへ1行足すだけで済むようにする。フォーム/送信ロジック側は
 * この表を見るだけで済み、ツールごとの分岐を増やさない)。
 * key は sanitizeProviderConfig(サーバ側)が要求する「provider_接頭辞」付きのキー名そのもの。
 */
interface ProviderExtraField {
  key: string
  label: string
  type?: string
  placeholder?: string
}
const PROVIDER_EXTRA_FIELDS: Partial<Record<IntegrationId, ProviderExtraField[]>> = {
  jira: [{ key: 'jira_email', label: 'メールアドレス(Basic認証)', type: 'email', placeholder: 'you@example.com' }],
}

/**
 * APIキー方式のタスク同期ツール(Backlog/Jooto/Jira/Redmine/Asana/Trello/Linear/Chatwork)接続パネル。
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
  const isImplemented = isImplementedTaskSyncProvider(integrationId)
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
  if (!def || !isImplemented) return null

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
          needsBaseUrl={taskSyncProviderNeedsBaseUrl(integrationId)}
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
  const extraFields = PROVIDER_EXTRA_FIELDS[integrationId] ?? []
  const [extraValues, setExtraValues] = useState<Record<string, string>>({})
  // Asana は所属ワークスペースが複数あると、どれを見るかを決めないと接続できない。
  // GIDの手入力は調べようがないため欄を最初から出さず、サーバが「選んでください」と
  // 返してきたときだけ、返ってきた一覧から選ばせる（ふつうは1つなので何も出ない）。
  const [workspaces, setWorkspaces] = useState<WorkspaceChoice[] | null>(null)
  const [workspaceGid, setWorkspaceGid] = useState('')
  const createConnection = useCreateTaskSyncConnection()
  const urlCopy = BASE_URL_COPY[integrationId] ?? DEFAULT_BASE_URL_COPY

  if (!canManage) {
    return <p className="text-[11px] text-gray-400">まだ接続がありません(owner/adminのみ接続できます)</p>
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const fromFields =
        extraFields.length > 0
          ? Object.fromEntries(extraFields.map((f) => [f.key, (extraValues[f.key] ?? '').trim()]))
          : undefined
      // 選択済みのワークスペースがあれば載せる（1回目の送信では付かない＝サーバが自動で決める）。
      const providerConfig = workspaceGid
        ? { ...(fromFields ?? {}), asana_workspace_gid: workspaceGid }
        : fromFields
      await createConnection.mutateAsync({
        orgId,
        provider: integrationId,
        apiKey,
        baseUrl: needsBaseUrl ? baseUrl.trim() : undefined,
        providerConfig,
      })
      // APIキーを画面/DOMに残さない(接続後はstateから消す)。追加欄(メール等)は秘密ではないので
      // 消さなくてもよいが、フォーム自体が消える(接続済み表示に切り替わる)ため実害はない。
      setApiKey('')
      setBaseUrl('')
      setExtraValues({})
      setWorkspaces(null)
      setWorkspaceGid('')
    } catch (err) {
      // 「まだ選ぶものがある」は失敗ではない。選択肢を出して、同じフォームで続けてもらう。
      if (err instanceof NeedsWorkspaceChoiceError) {
        setWorkspaces(err.workspaces)
        setWorkspaceGid(err.workspaces[0]?.gid ?? '')
        return
      }
      toast.error(err instanceof Error ? err.message : '接続に失敗しました')
    }
  }

  const canSubmit =
    apiKey.trim().length > 0 &&
    (!needsBaseUrl || baseUrl.trim().length > 0) &&
    extraFields.every((f) => (extraValues[f.key] ?? '').trim().length > 0)

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-2 max-w-sm">
      {integrationId === 'trello' && <TrelloTokenIssueLink />}
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
      {extraFields.map((field) => (
        <div key={field.key}>
          <label
            htmlFor={`task-sync-extra-${integrationId}-${field.key}`}
            className="block text-xs font-medium text-gray-700 mb-1"
          >
            {field.label}
          </label>
          <input
            id={`task-sync-extra-${integrationId}-${field.key}`}
            type={field.type ?? 'text'}
            value={extraValues[field.key] ?? ''}
            onChange={(e) => setExtraValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
            placeholder={field.placeholder}
            className="w-full h-8 rounded-md border border-gray-200 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      ))}
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
      {workspaces && workspaces.length > 0 && (
        <div>
          <label
            htmlFor={`task-sync-workspace-${integrationId}`}
            className="block text-xs font-medium text-gray-700 mb-1"
          >
            取り込むワークスペース
          </label>
          <select
            id={`task-sync-workspace-${integrationId}`}
            value={workspaceGid}
            onChange={(e) => setWorkspaceGid(e.target.value)}
            className="w-full h-8 rounded-md border border-gray-200 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            {workspaces.map((w) => (
              <option key={w.gid} value={w.gid}>
                {w.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-gray-400">
            複数のワークスペースに所属しているため、どれを取り込むか選んでください。
          </p>
        </div>
      )}
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

/**
 * Trello のトークン発行導線。
 *
 * Trello のトークンは「TaskApp のアプリキーを載せた許可URL」からでないと発行できず、
 * 他ツールのように「相手ツールの設定画面でキーを作ってくる」ができない。この導線が
 * 無い状態＝APIキー欄はあるのに埋めようがない＝実質つなげない状態だったので、
 * 未接続のときだけフォームの先頭に置く。
 *
 * アプリキーが未設定（＝この環境の配線が済んでいない）ときは、リンクの代わりに
 * 何が足りないかを伝える。黙って行き止まりにしない。
 */
function TrelloTokenIssueLink() {
  const authorizeUrl = getTrelloAuthorizeUrl()

  if (!authorizeUrl) {
    return (
      <p className="text-[11px] text-gray-500 leading-relaxed">
        Trello の接続にはこの環境の設定が足りていません。管理者にご連絡ください。
      </p>
    )
  }

  return (
    <div className="space-y-1">
      <a
        href={authorizeUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 h-8 rounded-md border border-gray-200 px-3 text-xs font-medium text-gray-700 hover:bg-gray-50 hover:text-gray-900 transition-colors"
      >
        Trello でトークンを発行する
        <ArrowSquareOut className="h-3.5 w-3.5" />
      </a>
      <p className="text-[11px] text-gray-400 leading-relaxed">
        開いた画面で「Allow」を押すと、長い英数字が表示されます。それを下の欄に貼ってください。
      </p>
    </div>
  )
}
