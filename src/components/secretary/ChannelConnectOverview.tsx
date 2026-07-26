import { ArrowSquareOut } from '@phosphor-icons/react/dist/ssr'
import type { ChannelDefinition } from '@/lib/channels/registry'
import { CHANNEL_ICONS } from '@/components/secretary/channelIcons'
import { ChannelCredentialForm } from '@/components/secretary/ChannelCredentialForm'
import { SharedBotClaimPanel } from '@/components/secretary/SharedBotClaimPanel'

// beta は内部区分（要検証）でありユーザーには見せない — 表示上は ga と同じ「利用可能」。
const STATUS_LABEL: Record<ChannelDefinition['status'], { label: string; cls: string }> = {
  ga: { label: '利用可能', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  beta: { label: '利用可能', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  planned: { label: '近日', cls: 'bg-gray-100 text-gray-500 border-gray-200' },
}

/**
 * 「つなぐ」ハブの汎用チャネル・セットアップ画面（LINE以外）。
 *
 * 情報設計は「主アクション優先」— 画面を開いた人が最初に見るのは *いま何をするか*
 * （合言葉を発行する / 資格情報を登録する）。送受信の対応状況・Webhookパス・資格情報の
 * JSONキーといった開発者向けメタ情報は、既定で畳んだ「技術的な設定内容」の中に置く。
 * registry の notes は doc生成用の内部メモなので画面には出さない。
 */
export function ChannelConnectOverview({ def, orgId }: { def: ChannelDefinition; orgId: string }) {
  const Icon = CHANNEL_ICONS[def.id]
  const status = STATUS_LABEL[def.status]
  // platform 共有bot（google_chat / discord 等・org は認証情報を登録しない）は、LINEと同様に
  // 汎用の資格情報登録フォームは出さず、合言葉発行の SharedBotClaimPanel を描画する。
  const isSharedBotClaim = !!def.sharedBotClaim
  // 実際に接続できる（送信可能・LINE/共有Bot以外）チャネルにのみ資格情報登録フォームを出す。
  const canRegister =
    def.outbound && def.status !== 'planned' && def.id !== 'line' && !isSharedBotClaim

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-6 max-w-2xl">
      <div className="flex items-center gap-3 mb-5">
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

      {/* 主アクション — 開いた人が最初にやることを最上部に置く */}
      {isSharedBotClaim && <SharedBotClaimPanel orgId={orgId} channel={def.id} />}
      {canRegister && <ChannelCredentialForm orgId={orgId} def={def} />}
      {!isSharedBotClaim && !canRegister && (
        <p className="text-sm text-gray-500">このチャネルは準備中です。開通しましたらご案内します。</p>
      )}

      {/* 開発者向けメタ情報 — 既定は畳む（運用者が必要なときだけ開く） */}
      <details className="mt-8 border-t border-gray-100 pt-4">
        <summary className="cursor-pointer text-xs font-medium text-gray-500 hover:text-gray-700">
          技術的な設定内容
        </summary>

        <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
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

        {!isSharedBotClaim && def.credentialFields.length > 0 && (
          <>
            <h2 className="mt-5 mb-2 text-xs font-semibold text-gray-500">資格情報のキー</h2>
            <ul className="space-y-2">
              {def.credentialFields.map((f) => (
                <li key={f.key} className="flex items-start gap-2 text-sm">
                  <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded shrink-0 mt-0.5">
                    {f.key}
                  </code>
                  <div>
                    <span className="text-gray-800">{f.label}</span>
                    {f.secret && (
                      <span className="ml-2 text-[10px] font-semibold text-red-500">機密</span>
                    )}
                    {f.help && <p className="text-xs text-gray-500">{f.help}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        {/* 共有Botチャネル（google_chat/discord等）は org が資格情報を貼り付ける開発者コンソールを
            持たない（運営がBotを提供する）ため、「開発者コンソールを開く」リンクは出さない。 */}
        {!isSharedBotClaim && def.setupUrl && (
          <a
            href={def.setupUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-amber-600 hover:text-amber-700"
          >
            開発者コンソールを開く
            <ArrowSquareOut className="w-4 h-4" />
          </a>
        )}
      </details>
    </div>
  )
}
