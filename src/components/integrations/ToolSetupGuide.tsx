'use client'

import { useId, useState } from 'react'
import { ArrowSquareOut, CaretDown, CaretRight, Question } from '@phosphor-icons/react'
import { getSetupGuide, getSetupGuideDocUrl } from '@/lib/integrations/setupGuides'

interface ToolSetupGuideProps {
  /** ツールのID（registry の IntegrationId）か、個人連携キー（google_calendar 等） */
  guideKey: string
  /** 最初から開いた状態にする（未接続で、まず手順を読んでほしい場面用） */
  defaultOpen?: boolean
  className?: string
}

/**
 * 「連携のしかた」ボタン — 押すと、そのツールの接続手順が開く。
 *
 * 手順の中身は setupGuides.ts（単一の真実源）から引く。画面ごとに文言を書かない。
 * 手順が無いツール（近日対応）では**何も描画しない**（押しても空のボタンを置かない）。
 *
 * 実装メモ:
 *  - モーダルは使わない（UI_RULES）。その場で開く開閉パネルにする。
 *  - 既存の `SetupGuide`（高さアニメーション付き）は閉じていても中身をDOMに残すため、
 *    スクリーンリーダーには常時読み上げられてしまう。手順は長文なので、ここでは
 *    `Hint` と同じく**開いているときだけ描画する**方式を採る。
 *  - 色は中央トークンのみ（白の直書き・`dark:` バリアントは使わない）。amber は
 *    「相手先に見える要素」の予約色なのでここでは使わない。
 */
export function ToolSetupGuide({ guideKey, defaultOpen = false, className }: ToolSetupGuideProps) {
  const [open, setOpen] = useState(defaultOpen)
  const panelId = useId()
  const guide = getSetupGuide(guideKey)

  if (!guide) return null

  const docUrl = getSetupGuideDocUrl(guideKey)

  return (
    <div className={className} data-testid="tool-setup-guide">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 hover:text-gray-900 transition-colors"
      >
        <Question className="h-3.5 w-3.5" weight="bold" />
        <span>連携のしかた</span>
        {open ? <CaretDown className="h-3 w-3" weight="bold" /> : <CaretRight className="h-3 w-3" weight="bold" />}
      </button>

      {open && (
        <div
          id={panelId}
          className="mt-2 max-w-2xl rounded-lg border border-gray-200 bg-gray-50 p-4 text-xs leading-relaxed text-gray-700 space-y-3"
        >
          <p className="text-gray-600">{guide.summary}</p>

          <ol className="list-decimal space-y-1.5 pl-5">
            {guide.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>

          {guide.notes && guide.notes.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-gray-500">
              {guide.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}

          {docUrl && (
            <a
              href={docUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 font-medium text-indigo-600 hover:text-indigo-800"
            >
              公式の手順を開く
              <ArrowSquareOut className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      )}
    </div>
  )
}
