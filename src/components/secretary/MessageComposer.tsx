'use client'

import { useState } from 'react'
import { PaperPlaneRight } from '@phosphor-icons/react'
import { CLIENT } from '@/lib/design/tokens'

const TEMPLATES: ReadonlyArray<{ label: string; text: string }> = [
  { label: '回収依頼', text: 'お手数ですが、資料のご提出をお願いいたします。' },
  { label: '確認依頼', text: '内容をご確認いただき、問題なければご返信ください。' },
  { label: 'リマインド', text: '前回ご案内した件、まだご対応いただけていないようでしたのでご連絡いたしました。' },
]

interface MessageComposerProps {
  /** 誤爆ガード: 送信先を常時表示する */
  targetLabel: string
  disabled: boolean
  disabledReason?: string
  onSend: (text: string) => Promise<{ ok: boolean; error?: string }>
}

/**
 * 秘書名義の送信ボックス。保存ボタン無し・optimistic update(親のuseChannelTimelineが担う)。
 * Amber-500 = クライアント可視要素の印として枠・送信ボタンにamberアクセントを付ける
 * (docs/spec/AI_SECRETARY_STAGE2_DESIGN.md §5)。
 */
export function MessageComposer({ targetLabel, disabled, disabledReason, onSend }: MessageComposerProps) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSend = async () => {
    const trimmed = text.trim()
    if (!trimmed || sending || disabled) return
    setSending(true)
    setError(null)
    const result = await onSend(trimmed)
    setSending(false)
    if (result.ok) {
      setText('')
    } else {
      setError(result.error ?? '送信に失敗しました')
    }
  }

  return (
    <div className="border-t border-gray-200 p-3 flex-shrink-0">
      <div className="flex items-center gap-1.5 mb-2">
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${CLIENT.badge}`}>
          送信先: {targetLabel}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-2">
        {TEMPLATES.map((template) => (
          <button
            key={template.label}
            type="button"
            disabled={disabled}
            onClick={() => setText((prev) => (prev ? `${prev}\n${template.text}` : template.text))}
            className="px-2 py-1 text-[11px] text-gray-600 bg-gray-50 border border-gray-200 rounded hover:bg-gray-100 disabled:opacity-40 disabled:hover:bg-gray-50 transition-colors"
          >
            {template.label}
          </button>
        ))}
      </div>

      {error && <p className="text-xs text-red-600 mb-1.5">{error}</p>}

      <div
        className={`flex items-end gap-2 border rounded-lg p-2 transition-colors ${CLIENT.border} focus-within:ring-2 focus-within:ring-amber-500/20 focus-within:border-amber-500`}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void handleSend()
            }
          }}
          disabled={disabled || sending}
          placeholder={disabled ? (disabledReason ?? '確認コードで連携してください') : 'メッセージを入力（⌘+Enterで送信）'}
          rows={2}
          className="flex-1 resize-none text-sm outline-none bg-transparent disabled:text-gray-300 disabled:cursor-not-allowed"
        />
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={disabled || sending || !text.trim()}
          className="flex-shrink-0 p-2 rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-40 disabled:hover:bg-amber-500 transition-colors"
          title="送信"
        >
          <PaperPlaneRight weight="fill" />
        </button>
      </div>
    </div>
  )
}
