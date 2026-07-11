'use client'

import { useState } from 'react'
import { Copy, Check, X, Warning } from '@phosphor-icons/react'

interface SecretRevealProps {
  secret: string
  onDismiss: () => void
}

/**
 * webhook secretの一度だけの表示（作成・ローテーション直後）。
 * 呼び出し側がonDismissでstateを破棄すると再表示できない（GET系APIはsecretを返さない）。
 */
export function SecretReveal({ secret, onDismiss }: SecretRevealProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(secret)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // 注意: amber-*はTaskApp規約で「クライアント可視要素」専用のため、内部専用の本パネルでは
  // 使わない（この画面は秘書コンソール内部のみ・クライアントは到達しない）。危険度が高い
  // 一度きりの値という意味でDanger(red)トークンを使う。
  return (
    <div className="rounded-lg border border-red-100 bg-red-50 p-3">
      <div className="flex items-start gap-2">
        <Warning className="text-red-600 text-sm flex-shrink-0 mt-0.5" weight="fill" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-red-600">
            このsecretは今だけ表示されます。二度と表示されないため、今すぐ控えてください。
          </p>
          <div className="mt-2 flex items-center gap-1.5">
            <code className="flex-1 min-w-0 truncate rounded bg-white border border-red-100 px-2 py-1 text-xs font-mono text-gray-900">
              {secret}
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
