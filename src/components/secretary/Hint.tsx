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
        /* 「そこに補足がある」と気づかれないと隠した意味がないので、地色を敷いて視認性を上げる。
           開いている間は反転させ、どの?を開いたか一目で分かるようにする。
           amber は「相手先に見える要素」を表す予約色（UI_RULES）なのでここでは使わない。 */
        className={`inline-flex h-[18px] w-[18px] items-center justify-center rounded-full border transition-colors ${
          open
            ? 'border-gray-700 bg-gray-700 text-white'
            : 'border-gray-300 bg-gray-100 text-gray-500 hover:border-gray-400 hover:bg-gray-200 hover:text-gray-700'
        }`}
      >
        <Question className="h-3 w-3" weight="bold" />
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
