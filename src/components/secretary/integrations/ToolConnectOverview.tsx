import { ArrowSquareOut } from '@phosphor-icons/react/dist/ssr'
import { DIRECTION_LABEL, type IntegrationDefinition } from '@/lib/integrations/registry'
import { INTEGRATION_ICONS } from '@/components/secretary/integrations/integrationIcons'

// beta は内部区分（要検証）でありユーザーには見せない — 表示上は ga と同じ「利用可能」。
const STATUS_LABEL: Record<IntegrationDefinition['status'], { label: string; cls: string }> = {
  ga: { label: '利用可能', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  beta: { label: '利用可能', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  planned: { label: '近日', cls: 'bg-gray-100 text-gray-500 border-gray-200' },
}

/**
 * 「ツール連携」カタログの汎用詳細概要（ChannelConnectOverview踏襲）。
 * planned(未実装/掲載のみ)・export(その場書き出し)・catalog全般に使う。
 * 実接続のUI(connector/sink)は各専用コンポーネント(ConnectorSyncPane/SinkProviderPanel)が持つため、
 * ここでは「何ができる/できる予定か」の説明に徹する。
 */
export function ToolConnectOverview({ def }: { def: IntegrationDefinition }) {
  const Icon = INTEGRATION_ICONS[def.id]
  const status = STATUS_LABEL[def.status]

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-6 max-w-2xl">
      <div className="flex items-center gap-3 mb-1">
        <Icon className="w-7 h-7 text-gray-700" />
        <h1 className="text-lg font-semibold text-gray-900">{def.label}</h1>
        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${status.cls}`}>
          {status.label}
        </span>
        {def.proOnly && (
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full border border-amber-300 bg-amber-100 text-amber-700">
            Pro
          </span>
        )}
      </div>

      {def.notes && <p className="text-sm text-gray-500 mb-5">{def.notes}</p>}

      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm mb-6">
        <dt className="text-gray-400">連携の方向</dt>
        <dd className="text-gray-800">{DIRECTION_LABEL[def.direction]}</dd>
      </dl>

      {def.status === 'planned' && (
        <p className="text-sm text-gray-600 mb-6">近日対応。ロードマップに沿って順次実装します。</p>
      )}

      {def.surface === 'export' && (
        <p className="text-sm text-gray-600 mb-6">
          タスクのCSVは各プロジェクトの「設定 → データ管理 →
          データエクスポート」から書き出せます（freee・マネーフォワード等の会計ソフトへの取り込み用途）。
          このコンソールは複数プロジェクトを横断するため、実際の書き出しは各プロジェクトの設定画面で行います。
        </p>
      )}

      {def.setupUrl && (
        <a
          href={def.setupUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-600 hover:text-amber-700"
        >
          詳細を開く
          <ArrowSquareOut className="w-4 h-4" />
        </a>
      )}
    </div>
  )
}
