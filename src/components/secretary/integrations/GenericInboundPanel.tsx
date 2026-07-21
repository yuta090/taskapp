'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Warning, X } from '@phosphor-icons/react'
import {
  useConnectors,
  useCreateGenericInboundConnection,
  type ConnectorConnection,
  type CreateGenericInboundConnectionResult,
} from '@/lib/hooks/useConnectors'
import { CopyRow } from '@/components/secretary/integrations/MulticaConnectionReveal'
import { ConnectorStatusPill, ImportConfigEditor } from '@/components/secretary/integrations/ConnectorSyncPane'

interface GenericInboundPanelProps {
  orgId: string
}

/** 送信側(Zapier/Make/n8n等)に見せるペイロード例。genericPayload.tsの契約をそのまま反映する。 */
const EXAMPLE_EVENT = {
  event_id: 'evt_2026-07-21T00:00:00Z-001',
  event_type: 'task.created',
  connection_id: '<作成後にこの画面で表示される接続ID>',
  external_id: 'EXT-123',
  title: '見積書の確認',
  body: '先方から差し戻しがありました',
  due_date: '2026-07-25',
}

/**
 * 汎用Webhook受信(generic_inbound)の接続UI。
 *
 * 公開APIが無い/弱いツール(業界特化型の長尾)向けの受け口。こちらから外部を叩かないため、
 * multica/gtasksと違い接続先URLやAPIキーは預からず、「送り先URL」と「署名鍵」だけを発行する。
 * ConnectorSyncPane.tsxを手本にする(モーダル禁止・保存ボタン禁止=optimistic、owner/adminのみ
 * 作成・設定可能)。取り込み設定はImportConfigEditorをそのまま流用する(重複実装しない)。
 */
export function GenericInboundPanel({ orgId }: GenericInboundPanelProps) {
  const { connections, viewerRole, isLoading } = useConnectors(orgId)
  const canManage = viewerRole === 'owner' || viewerRole === 'admin'
  const genericConnections = connections.filter((c) => c.provider === 'generic_inbound')

  const [labelDraft, setLabelDraft] = useState('')
  const [justCreated, setJustCreated] = useState<CreateGenericInboundConnectionResult | null>(null)
  const createConnection = useCreateGenericInboundConnection()

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const result = await createConnection.mutateAsync({ orgId, label: labelDraft.trim() || undefined })
      setJustCreated(result)
      setLabelDraft('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '受信口の作成に失敗しました')
    }
  }

  if (isLoading) {
    return (
      <section data-testid="generic-inbound-panel-skeleton" className="flex-1 min-h-0 px-4 py-3">
        <div className="h-3 w-32 bg-gray-100 rounded animate-pulse mb-2" />
        <div className="h-8 w-full bg-gray-100 rounded animate-pulse" />
      </section>
    )
  }

  return (
    <section className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-4">
      <header>
        <h2 className="text-xs font-semibold text-gray-900">その他のツール（Webhook）</h2>
        <p className="mt-1 text-[11px] text-gray-400 leading-relaxed">
          公開APIが無い/弱いツールでも、Zapier・Make・n8n などから決まった形のWebhookを送れば取り込めます。
          受信のみで、こちらから外部へは取りに行きません(接続先URL・APIキーは預かりません)。
        </p>
      </header>

      {justCreated && (
        <GenericInboundReveal
          webhookUrl={justCreated.webhookUrl}
          receiveSecret={justCreated.receiveSecret}
          onDismiss={() => setJustCreated(null)}
        />
      )}

      {canManage ? (
        <form onSubmit={(e) => void handleCreate(e)} className="rounded-lg border border-gray-200 p-3 space-y-2">
          <div>
            <label htmlFor="generic-inbound-label" className="block text-xs font-medium text-gray-700 mb-1">
              呼び名（任意・複数の送信元を見分けるため）
            </label>
            <input
              id="generic-inbound-label"
              type="text"
              value={labelDraft}
              onChange={(e) => setLabelDraft(e.target.value)}
              placeholder="例: ANDPAD経由"
              className="w-full h-8 rounded-md border border-gray-200 px-2 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <button
            type="submit"
            disabled={createConnection.isPending}
            className="h-8 rounded-md px-3 text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {createConnection.isPending ? '作成中...' : '受信口を作る'}
          </button>
        </form>
      ) : (
        genericConnections.length === 0 && (
          <p className="text-[11px] text-gray-400">まだ受信口がありません(owner/adminのみ作成できます)</p>
        )
      )}

      {genericConnections.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-gray-900">受信口一覧</h3>
          {genericConnections.map((connection) => (
            <GenericInboundConnectionCard
              key={connection.id}
              orgId={orgId}
              connection={connection}
              canManage={canManage}
            />
          ))}
        </div>
      )}

      <SendingSetupGuide />
    </section>
  )
}

interface GenericInboundRevealProps {
  webhookUrl: string
  receiveSecret: string
  onDismiss: () => void
}

/**
 * 受信口作成直後の一度きり表示(webhook_url/receive_secret)。
 * MulticaConnectionRevealと同じCopyRowを共有する(コピー導線を重複実装しない)。
 * GET系APIはsecretを二度と返さないため、onDismiss後(や再マウント後)は再表示できない。
 */
function GenericInboundReveal({ webhookUrl, receiveSecret, onDismiss }: GenericInboundRevealProps) {
  return (
    <div className="rounded-lg border border-red-100 bg-red-50 p-3">
      <div className="flex items-start gap-2">
        <Warning className="text-red-600 text-sm flex-shrink-0 mt-0.5" weight="fill" />
        <div className="min-w-0 flex-1 space-y-2.5">
          <p className="text-xs font-medium text-red-600">
            送信元(Zapier等)の設定画面にこの2項目を貼り付けてください。この画面を離れると二度と表示されません。今すぐ控えてください。
          </p>
          <CopyRow label="送り先URL(Webhook URL)" value={webhookUrl} />
          <CopyRow label="署名鍵(receive_secret)" value={receiveSecret} />
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="p-1 text-red-600 hover:text-red-600 transition-colors flex-shrink-0"
          title="閉じる"
        >
          <X className="text-sm" />
          <span className="sr-only">閉じる</span>
        </button>
      </div>
    </div>
  )
}

interface GenericInboundConnectionCardProps {
  orgId: string
  connection: ConnectorConnection
  canManage: boolean
}

/**
 * 受信口1件分の状態と取り込み設定。
 * 呼び名(label)は任意設定のため無いこともある(その場合は接続IDの先頭で代替表示する)。
 */
function GenericInboundConnectionCard({ orgId, connection, canManage }: GenericInboundConnectionCardProps) {
  const targetSpaceId = (connection.importConfig as { target_space_id?: string }).target_space_id
  const configured = !!targetSpaceId

  return (
    <div className="rounded-lg border border-gray-200 p-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <ConnectorStatusPill status={connection.status} />
        <span className="text-xs text-gray-700">
          {connection.label ?? `#${connection.id.slice(0, 8)}`}
        </span>
      </div>

      {!configured && (
        <div
          data-testid="generic-inbound-target-space-warning"
          className="rounded-md border border-red-100 bg-red-50 px-2.5 py-2 flex items-start gap-1.5"
        >
          <Warning className="text-red-600 text-sm flex-shrink-0 mt-0.5" weight="fill" />
          <p className="text-[11px] text-red-600">
            取り込み先スペースが未設定です。設定するまで、この受信口へのWebhookは422で拒否されます。下で設定してください。
          </p>
        </div>
      )}

      <ImportConfigEditor orgId={orgId} connection={connection} canManage={canManage} />
    </div>
  )
}

/** 応答コードの意味(docs/spec/GENERIC_INBOUND_WEBHOOK_v1.md §4が正本。文言はそちらに合わせる)。 */
const RESPONSE_CODES: Array<{ code: string; meaning: string }> = [
  { code: '200', meaning: '受理(または再送の重複として無視)。何もしなくてよい' },
  { code: '400', meaning: 'ペイロードが仕様に合わない(理由は本文に入る)。設定を直す' },
  { code: '401', meaning: '署名が不正、または受信口が無効/存在しない。鍵・connection_id・有効化を確認' },
  { code: '404', meaning: 'その external_id が未取り込み。先に task.created を送る' },
  { code: '409', meaning: '取り込み済みタスクがTaskApp側で削除されている。新しい external_id で作り直す' },
  { code: '413', meaning: 'ボディが大きすぎる(上限64KB)' },
  { code: '422', meaning: '受信口に取り込み先スペースが未設定。設定後に再送すれば通る' },
  { code: '5xx', meaning: 'TaskApp側の一時的な障害。再送してよい' },
]

/**
 * 送信側(Zapier/Make/n8n等)の設定手順。docs/spec/GENERIC_INBOUND_WEBHOOK_v1.md(顧客向け正式仕様書・
 * 正本)の内容を画面用にかみ砕いたもの。文言が食い違ったら仕様書側に合わせること。
 * WebhookReceiverGuide(sink=TaskApp発信の受信側向け)とはペイロード形も役割の向きも異なるため
 * 使い回さない。相手へ事前に見せられるよう、受信口が無くても常に表示する。
 */
function SendingSetupGuide() {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-2.5">
      <h3 className="text-xs font-semibold text-gray-900">送信側の設定手順</h3>
      <div className="text-[11px] text-gray-600 leading-relaxed space-y-2">
        <p>
          Zapier / Make / n8n などから、上の「受信口を作る」で発行した送り先URLへ POST してください。
          イベント種別は <code className="font-mono bg-gray-50 px-1 rounded">task.created</code> /{' '}
          <code className="font-mono bg-gray-50 px-1 rounded">task.updated</code> /{' '}
          <code className="font-mono bg-gray-50 px-1 rounded">task.completed</code> の3種類です。
          <code className="font-mono bg-gray-50 px-1 rounded">task.updated</code> /{' '}
          <code className="font-mono bg-gray-50 px-1 rounded">task.completed</code> は、先に同じ
          <code className="font-mono bg-gray-50 px-1 rounded">external_id</code> で
          <code className="font-mono bg-gray-50 px-1 rounded">task.created</code> を送っている必要があります。
        </p>
        <div>
          <p className="font-medium text-gray-700">署名ヘッダ</p>
          <p>
            <code className="font-mono bg-gray-50 px-1 rounded">X-AgentPM-Signature</code>:{' '}
            <code className="font-mono bg-gray-50 px-1 rounded">
              t=&lt;unix秒&gt;,v1=&lt;hex(hmac_sha256(受信鍵, t + &quot;.&quot; + body))&gt;
            </code>
            （Stripe/Slack同型。ボディは送信したそのままのバイト列で署名すること。
            <code className="font-mono bg-gray-50 px-1 rounded">t</code>
            が現在時刻から±5分の範囲外のリクエストはリプレイとして拒否します）
          </p>
        </div>
        <div>
          <p className="font-medium text-gray-700">ペイロードの例（ボディ上限 64KB）</p>
          <pre
            data-testid="generic-inbound-payload-example"
            className="rounded bg-gray-50 border border-gray-100 p-2 text-[11px] font-mono overflow-x-auto whitespace-pre-wrap"
          >
            {JSON.stringify(EXAMPLE_EVENT, null, 2)}
          </pre>
          <p className="mt-1 text-[11px] text-gray-400">
            event_idは再送時の重複排除キー(同じイベントには同じ値)。due_dateは時刻を含まない
            YYYY-MM-DD形式のみ。body/due_dateは省略すると変更せず、明示的に
            <code className="font-mono bg-gray-50 px-1 rounded">null</code>
            を送るとその項目を空にします。
          </p>
        </div>
        <div>
          <p className="font-medium text-gray-700">応答コードと再送</p>
          <ul className="space-y-0.5">
            {RESPONSE_CODES.map(({ code, meaning }) => (
              <li key={code}>
                <code className="font-mono bg-gray-50 px-1 rounded">{code}</code> — {meaning}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[11px] text-gray-400">
            再送は安全です。同じevent_idは処理済みなら200を返すだけで副作用は起きません。
          </p>
        </div>
        <p className="text-[11px] text-gray-400">
          鍵が漏れると、その受信口のスペースに誰でもタスクを作れます。Zapier等に登録した鍵は
          認証情報と同じ扱いにし、漏れた場合は受信口を作り直してください。完了の書き戻しはできません
          (TaskApp側で完了にしても、送信元のツールには反映されません)。
        </p>
      </div>
    </div>
  )
}
