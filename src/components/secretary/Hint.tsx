'use client'

import { useId, useState, type ReactNode } from 'react'
import { Question } from '@phosphor-icons/react'

interface HintProps {
  /** 何についての補足か（スクリーンリーダー向けのボタン名になる） */
  label: string
  children: ReactNode
}

/**
 * 補足説明を「?」の後ろに隠す小さな開閉パネル。
 *
 * 「つなぐ」画面は *いま押すべきボタン* が主役。「なぜ必要か」「例外」「注意」は
 * 常時表示すると認知負荷になるだけなので、この Hint に寄せて既定は閉じておく。
 * モーダルは使わない（UI_RULES: タスク詳細以外もダイアログ禁止の方針に合わせる）。
 */
export function Hint({ label, children }: HintProps) {
  const [open, setOpen] = useState(false)
  const panelId = useId()

  return (
    <span className="relative ml-1.5 inline-flex align-middle">
      <button
        type="button"
        aria-label={`${label}の補足`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-gray-300 text-gray-400 hover:border-gray-400 hover:text-gray-600"
      >
        <Question className="h-2.5 w-2.5" weight="bold" />
      </button>
      {open && (
        <span
          id={panelId}
          role="note"
          className="absolute left-0 top-5 z-20 block w-64 rounded border border-gray-200 bg-surface p-2.5 text-[11px] leading-relaxed text-gray-600 shadow-lg"
        >
          {children}
        </span>
      )}
    </span>
  )
}
