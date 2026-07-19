import { ArrowSquareOut } from '@phosphor-icons/react/dist/ssr'
import type { ChannelDefinition } from '@/lib/channels/registry'
import { CHANNEL_ICONS } from '@/components/secretary/channelIcons'

const STATUS_LABEL: Record<ChannelDefinition['status'], { label: string; cls: string }> = {
  ga: { label: '利用可能', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  beta: { label: 'BETA', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  planned: { label: '近日', cls: 'bg-gray-100 text-gray-500 border-gray-200' },
}

/**
 * 「つなぐ」ハブの汎用チャネル・セットアップ概要（LINE以外）。
 * レジストリの定義（実装状況・資格情報フィールド・受信Webhook・Pro区分）を表示し、
 * 「運用者が何を設定するか」をアプリ内でも参照できるようにする。
 * 実接続の登録UI(資格情報の保存)は各チャネルのAPI整備に合わせて順次追加する。
 */
export function ChannelConnectOverview({ def }: { def: ChannelDefinition }) {
  const Icon = CHANNEL_ICONS[def.id]
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
        <dt className="text-gray-400">送信</dt>
        <dd className="text-gray-800">{def.outbound ? '対応' : '未対応'}</dd>
        <dt className="text-gray-400">受信</dt>
        <dd className="text-gray-800">{def.inbound ? '対応' : '準備中'}</dd>
        <dt className="text-gray-400">送信先</dt>
        <dd className="text-gray-800">{def.targetHint}</dd>
        {def.webhookPath && (
          <>
            <dt className="text-gray-400">受信Webhook</dt>
            <dd className="text-gray-800 break-all">
              <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{def.webhookPath}</code>
            </dd>
          </>
        )}
      </dl>

      <h2 className="text-sm font-semibold text-gray-700 mb-2">用意する資格情報</h2>
      {def.credentialFields.length === 0 ? (
        <p className="text-sm text-gray-500">このチャネルに追加の資格情報は不要です。</p>
      ) : (
        <ul className="space-y-2 mb-6">
          {def.credentialFields.map((f) => (
            <li key={f.key} className="flex items-start gap-2 text-sm">
              <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded shrink-0 mt-0.5">{f.key}</code>
              <div>
                <span className="text-gray-800">{f.label}</span>
                {f.secret && <span className="ml-2 text-[10px] font-semibold text-red-500">機密</span>}
                {f.help && <p className="text-xs text-gray-500">{f.help}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}

      {def.setupUrl && (
        <a
          href={def.setupUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-600 hover:text-amber-700"
        >
          開発者コンソールを開く
          <ArrowSquareOut className="w-4 h-4" />
        </a>
      )}

      <p className="mt-8 text-xs text-gray-400 border-t border-gray-100 pt-4">
        接続手順の詳細は <code>docs/setup/CHANNEL_CONNECTIONS_SETUP.html</code> を参照。
        資格情報の登録UIは順次提供します（現在は手順の確認と実装状況の把握用）。
      </p>
    </div>
  )
}
