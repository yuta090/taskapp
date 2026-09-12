'use client'

import { useCallback, useRef, useState } from 'react'
import { LinkSimple } from '@phosphor-icons/react'
import dynamic from 'next/dynamic'
import { EditorToolbarButton } from './EditorToolbarButton'
import type { AppLink } from '@/lib/navigation/appLinks'

/** パネルの高さの上限と、画面の端との余白 */
const PANEL_MAX_HEIGHT = 320
const EDGE_MARGIN = 16
/** これより狭いと一覧が読めないので、狭いほうには出さない */
const MIN_USABLE_HEIGHT = 180

/**
 * ピッカーは押したときだけ読み込む。中でタスク・会議・ファイル・Wiki の取得層を
 * まとめて参照するため、置いておくとエディタを開いただけで一式が載る
 */
const AppLinkPicker = dynamic(() => import('./AppLinkPicker').then((m) => m.AppLinkPicker), {
  ssr: false,
  loading: () => (
    <div className="w-72 rounded-lg border border-gray-200 bg-surface p-3 text-xs text-gray-400 shadow-lg">
      読み込み中...
    </div>
  ),
})

interface Placement {
  above: boolean
  maxHeight: number
}

const DEFAULT_PLACEMENT: Placement = { above: true, maxHeight: PANEL_MAX_HEIGHT }

interface InsertLinkControlProps {
  orgId: string
  spaceId: string
  isOpen: boolean
  onToggle: () => void
  onSelect: (link: AppLink) => void
  /** 候補から外す Wiki ページ。いま開いているページ自身へのリンクは要らない */
  excludeWikiPageId?: string
}

/**
 * 「リンクを挿入」のボタンと、その選択パネル。Wiki と議事録で同じものを使う。
 *
 * パネルはボタンの上に出すのが基本（本文の下にボタンがあるため）。ただし本文が短いと
 * 上に入りきらず、画面の外に切れて選べなくなるので、**空いているほうに出す**。
 * 測るのはパネルが実際に置かれた瞬間（ref が付いたとき）。effect の中で state を
 * 動かすと描き直しが連鎖するため、ここでは ref のコールバックで1回だけ決める。
 */
export function InsertLinkControl({ orgId, spaceId, isOpen, onToggle, onSelect, excludeWikiPageId }: InsertLinkControlProps) {
  const anchorRef = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState<Placement>(DEFAULT_PLACEMENT)

  const measurePlacement = useCallback((node: HTMLDivElement | null) => {
    if (!node) return
    const rect = anchorRef.current?.getBoundingClientRect()
    if (!rect) return
    const above = rect.top - EDGE_MARGIN
    const below = window.innerHeight - rect.bottom - EDGE_MARGIN
    // 上に入るなら上。入らないなら広いほうに出す
    const useAbove = above >= PANEL_MAX_HEIGHT || (above >= MIN_USABLE_HEIGHT && above >= below)
    const next: Placement = {
      above: useAbove,
      maxHeight: Math.max(MIN_USABLE_HEIGHT, Math.min(PANEL_MAX_HEIGHT, useAbove ? above : below)),
    }
    setPlacement((prev) =>
      prev.above === next.above && prev.maxHeight === next.maxHeight ? prev : next
    )
  }, [])

  return (
    <div className="relative" ref={anchorRef}>
      <EditorToolbarButton
        icon={<LinkSimple />}
        label="リンクを挿入"
        data-testid="editor-insert-link"
        onClick={onToggle}
      />
      {isOpen && (
        <div
          ref={measurePlacement}
          className={`absolute left-0 z-10 ${placement.above ? 'bottom-full mb-2' : 'top-full mt-2'}`}
        >
          <AppLinkPicker
            orgId={orgId}
            spaceId={spaceId}
            onSelect={onSelect}
            maxHeight={placement.maxHeight}
            excludeWikiPageId={excludeWikiPageId}
          />
        </div>
      )}
    </div>
  )
}
