'use client'

import { useState } from 'react'
import type { ChannelDefinition } from '@/lib/channels/registry'
import { requiredCredentialFields } from '@/lib/channels/registry'

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
    } catch {
      setError('通信に失敗しました。時間をおいて再度お試しください。')
    } finally {
      setSubmitting(false)
    }
  }

  const generatedEntries = result ? Object.entries(result.generatedSecrets) : []

  return (
    <form onSubmit={onSubmit} className="mt-6 border-t border-gray-100 pt-6">
      <h2 className="text-sm font-semibold text-gray-700 mb-1">資格情報を登録する</h2>
      <p className="text-xs text-gray-500 mb-4">
        自社アカウント（白ラベル）接続は Pro プラン限定です。保存した資格情報は暗号化され、画面には再表示されません。
      </p>

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

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="inline-flex items-center rounded bg-amber-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
      >
        {submitting ? '登録中…' : '接続する'}
      </button>

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
                    <code className="break-all rounded bg-white px-1.5 py-0.5">{value}</code>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.webhookUrl && (
            <div className="mt-3">
              <p className="text-xs font-semibold text-emerald-700">受信Webhook URL</p>
              <code className="mt-1 block break-all rounded bg-white px-1.5 py-0.5 text-xs text-gray-700">
                {result.webhookUrl}
              </code>
            </div>
          )}
        </div>
      )}
    </form>
  )
}
