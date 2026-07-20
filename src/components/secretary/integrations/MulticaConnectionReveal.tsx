'use client'

import { useState } from 'react'
import { Copy, Check, X, Warning } from '@phosphor-icons/react'

interface MulticaConnectionRevealProps {
  webhookUrl: string
  connectionId: string
  sendSecret: string
  receiveSecret: string
  onDismiss: () => void
}

interface CopyRowProps {
  label: string
  value: string
}

/**
 * multica接続の作成直後、multica側に貼り付ける設定ブロックを1項目分表示する行。
 * SecretReveal.tsxのコピー導線と同じ実装（このパネル専用のため共通化はしない）。
 */
function CopyRow({ label, value }: CopyRowProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div>
      <span className="block text-[11px] font-medium text-red-600">{label}</span>
      <div className="mt-1 flex items-center gap-1.5">
        <code className="flex-1 min-w-0 truncate rounded bg-white border border-red-100 px-2 py-1 text-xs font-mono text-gray-900">
          {value}
        </code>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="p-1.5 text-red-600 hover:text-red-800 transition-colors flex-shrink-0"
          title="コピー"
        >
          {copied ? <Check className="text-sm text-green-600" /> : <Copy className="text-sm" />}
          <span className="sr-only">コピー</span>
        </button>
      </div>
    </div>
  )
}

/**
 * multica接続の作成直後に一度きり表示する設定ブロック
 * (webhook_url / connection_id / send_secret / receive_secret)。
 * multica側の管理画面へこの4値を貼ることで双方向の署名検証(§5)が成立する。
 * SecretReveal.tsxと同じ視覚言語(Danger/red、amberは使わない=内部専用画面)を踏襲する。
 * GET系APIはsecretを二度と返さないため、onDismiss後は再表示できない。
 */
export function MulticaConnectionReveal({
  webhookUrl,
  connectionId,
  sendSecret,
  receiveSecret,
  onDismiss,
}: MulticaConnectionRevealProps) {
  return (
    <div className="rounded-lg border border-red-100 bg-red-50 p-3">
      <div className="flex items-start gap-2">
        <Warning className="text-red-600 text-sm flex-shrink-0 mt-0.5" weight="fill" />
        <div className="min-w-0 flex-1 space-y-2.5">
          <p className="text-xs font-medium text-red-600">
            multica側の設定画面にこの4項目を貼り付けてください。この画面を離れると再表示できません。今すぐ控えてください。
          </p>
          <CopyRow label="Webhook URL" value={webhookUrl} />
          <CopyRow label="接続ID" value={connectionId} />
          <CopyRow label="送信鍵(TaskApp→multica)" value={sendSecret} />
          <CopyRow label="受信鍵(multica→TaskApp)" value={receiveSecret} />
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
