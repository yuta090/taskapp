'use client'

import { useState } from 'react'
import type { ChannelDefinition } from '@/lib/channels/registry'
import { requiredCredentialFields } from '@/lib/channels/registry'
import { useOrgChannelAccount } from '@/lib/hooks/useOrgChannelAccount'

interface Props {
  orgId: string
  def: ChannelDefinition
}

interface RegisterResult {
  created: boolean
  generatedSecrets: Record<string, string>
  webhookUrl: string | null
}

/**
 * 資格情報の登録フォーム（client）。registry の credentialFields を唯一の真実源にして
 * 入力欄を組み、POST /api/channels/accounts で保存する（作成/ローテート）。
 *
 * - generated フィールド（webhook_secret 等）は入力欄に出さない — サーバーが生成し、
 *   登録レスポンスの generatedSecrets として一度だけ表示する（provider 側に設定してもらう）。
 * - optional フィールドは「任意」ラベル付きで出す。
 * - 402（Free）は Pro 案内へ、その他エラーはメッセージ表示。
 */
export function ChannelCredentialForm({ orgId, def }: Props) {
  const required = requiredCredentialFields(def)
  const optional = def.credentialFields.filter((f) => !f.generated && f.optional)
  const inputs = [...required, ...optional]

  // 接続状態（合鍵そのものは返らない。表示名・登録日・有効/無効だけ）。
  // 合鍵は再表示しない仕様のため、これが無いと毎回まっさらのフォームになり
  // 「つながっていない」ように見えてしまう（Slack 作り直しの際に実際に誤解を招いた）。
  // SlackSecretarySetupGuide と同じ hook/クエリキーを使い、同じページで二重に取りに行かない
  const { data: account, isPending: accountLoading, refetch } = useOrgChannelAccount(orgId, def.id)
  const [rotating, setRotating] = useState(false)

  const [values, setValues] = useState<Record<string, string>>({})
  const [displayName, setDisplayName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<RegisterResult | null>(null)

  function setField(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }))
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setResult(null)

    // クライアント側の必須検証（サーバーでも検証するが、無駄な往復を避ける）。
    const missing = required.find((f) => !(values[f.key] ?? '').trim())
    if (missing) {
      setError(`${missing.label} は必須です`)
      return
    }

    setSubmitting(true)
    try {
      const credentials: Record<string, string> = {}
      for (const f of inputs) {
        const v = (values[f.key] ?? '').trim()
        if (v) credentials[f.key] = v
      }
      const res = await fetch('/api/channels/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          channel: def.id,
          displayName: displayName.trim() || undefined,
          credentials,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (!res.ok) {
        if (json.code === 'own_line_account_required') {
          setError('Proプランで自社アカウント（白ラベル）を接続できます。')
        } else if (json.code === 'missing_credential') {
          setError(typeof json.error === 'string' ? json.error : '必須項目が未入力です')
        } else {
          setError(
            (typeof json.message === 'string' && json.message) ||
              (typeof json.error === 'string' && json.error) ||
              '登録に失敗しました',
          )
        }
        return
      }
      setResult({
        created: json.created !== false,
        generatedSecrets: (json.generatedSecrets as Record<string, string>) ?? {},
        webhookUrl: (json.webhookUrl as string | null) ?? null,
      })
      // 同じページの案内（SlackSecretarySetupGuide 等）が進み具合を取り直せるように知らせる
      window.dispatchEvent(
        new CustomEvent('agentpm:channel-account-registered', { detail: { orgId, channel: def.id } }),
      )
      // 保存できたら入力欄を畳み、接続状態カードを取り直す（合鍵の値はここに残さない）
      setValues({})
      setRotating(false)
      void refetch()
    } catch {
      setError('通信に失敗しました。時間をおいて再度お試しください。')
    } finally {
      setSubmitting(false)
    }
  }

  const generatedEntries = result ? Object.entries(result.generatedSecrets) : []
  const connected = !!account
  // 初回(キャッシュ無し)は取得が終わるまで入力欄を出さない。先に空フォームを描くと
  // 「接続済み」カードへ差し替わる瞬間に、直そうとしている誤解そのものが再現する。
  const checking = accountLoading && !account
  const showInputs = !checking && (!connected || rotating)

  return (
    <form onSubmit={onSubmit}>
      <h2 className="text-sm font-semibold text-gray-700 mb-1">資格情報を登録する</h2>
      <p className="text-xs text-gray-500 mb-4">
        自社アカウント（白ラベル）接続は Pro プラン限定です。保存した資格情報は暗号化され、画面には再表示されません。
      </p>

      {checking && (
        <p className="mb-4 text-xs text-gray-400" data-testid="channel-connect-checking">
          接続状態を確認中…
        </p>
      )}

      {connected && account && (
        <div
          className="mb-4 rounded border border-emerald-200 bg-emerald-50 px-3 py-2"
          data-testid="channel-connected-card"
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="font-medium text-emerald-800">接続済み</span>
            <span className="text-gray-900">{account.displayName || def.label}</span>
            <span className="text-xs text-gray-500">
              {new Date(account.createdAt).toLocaleDateString('ja-JP')} 登録
            </span>
            {account.status === 'disabled' && (
              <span className="rounded border border-gray-300 bg-gray-100 px-1.5 py-0.5 text-[11px] font-semibold text-gray-600">
                無効
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-gray-500">
            合鍵は保存済みです（安全のため画面には出しません）。入れ直すときだけ下のボタンを押してください。
            {account.status === 'disabled' && ' 入れ直すと有効に戻ります。'}
          </p>
          {!rotating && (
            <button
              type="button"
              onClick={() => setRotating(true)}
              className="mt-2 inline-flex items-center rounded border border-gray-200 bg-surface px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
            >
              合鍵を入れ直す
            </button>
          )}
        </div>
      )}

      {showInputs && (
        <>
        <label className="block mb-3">
          <span className="text-xs text-gray-500">表示名（任意）</span>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={def.label}
            className="mt-1 w-full rounded border border-gray-200 px-2 py-1.5 text-sm"
          />
        </label>

        {inputs.map((f) => (
          <label key={f.key} className="block mb-3">
            <span className="text-xs text-gray-500">
              {f.label}
              {f.optional && <span className="ml-1 text-gray-400">（任意）</span>}
            </span>
            <input
              data-testid={`cred-input-${f.key}`}
              type={f.secret ? 'password' : 'text'}
              autoComplete="off"
              value={values[f.key] ?? ''}
              onChange={(e) => setField(f.key, e.target.value)}
              className="mt-1 w-full rounded border border-gray-200 px-2 py-1.5 text-sm font-mono"
            />
            {f.help && <span className="mt-0.5 block text-[11px] text-gray-400">{f.help}</span>}
          </label>
        ))}
        </>
      )}

      {showInputs && error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {showInputs && (
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center rounded bg-amber-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
          >
            {submitting ? '登録中…' : connected ? '更新する' : '接続する'}
          </button>
          {connected && rotating && (
            <button
              type="button"
              onClick={() => {
                setRotating(false)
                setValues({})
                setError(null)
              }}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              やめる
            </button>
          )}
        </div>
      )}

      {result && (
        <div className="mt-5 rounded border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm font-medium text-emerald-800">
            {result.created ? '接続しました' : '資格情報を更新しました'}
          </p>

          {generatedEntries.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold text-emerald-700">
                以下の生成値はこの画面でのみ表示されます。控えて provider 側に設定してください。
              </p>
              <ul className="mt-1 space-y-1">
                {generatedEntries.map(([key, value]) => (
                  <li key={key} className="text-xs text-gray-700">
                    <span className="text-gray-500">{key}: </span>
                    <code className="break-all rounded bg-surface px-1.5 py-0.5">{value}</code>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.webhookUrl && (
            <div className="mt-3">
              <p className="text-xs font-semibold text-emerald-700">受信Webhook URL</p>
              <code className="mt-1 block break-all rounded bg-surface px-1.5 py-0.5 text-xs text-gray-700">
                {result.webhookUrl}
              </code>
            </div>
          )}
        </div>
      )}
    </form>
  )
}
