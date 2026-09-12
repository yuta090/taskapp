'use client'

import { useMemo, useState } from 'react'
import { MagnifyingGlass, FileText } from '@phosphor-icons/react'
import { useWikiPages } from '@/lib/hooks/useWikiPages'
import { createWikiPageSearch } from '@/lib/wiki/pageSearch'

export interface MinutesWikiPageOption {
  id: string
  title: string
}

interface MinutesWikiLinkPickerProps {
  orgId: string
  spaceId: string
  onSelect: (page: MinutesWikiPageOption) => void
}

/**
 * 議事録エディタから Wiki ページを名前で探してリンクを差し込むためのピッカー。
 * モーダル禁止のUIルールに従い、呼び出し側がインラインパネルとして絶対配置する想定。
 *
 * `src/components/task/WikiPageLinkPicker.tsx` とは別物（あちらは選んだ値を持ち、
 * 見つからなければその場で作る「紐づけ」用）。こちらは常にカーソル位置へのリンク挿入で、
 * 値を持たない・作成もしない（Wiki ページ一覧に無ければ探し方を変えてもらうだけ）。
 */
export function MinutesWikiLinkPicker({ orgId, spaceId, onSelect }: MinutesWikiLinkPickerProps) {
  const { pages, loading } = useWikiPages({ orgId, spaceId, canEdit: false })
  const [query, setQuery] = useState('')

  const search = useMemo(() => createWikiPageSearch(pages), [pages])
  const { matches, total } = useMemo(() => search(query, 8), [search, query])
  const hiddenCount = total - matches.length

  return (
    <div className="w-72 max-w-[calc(100vw-2rem)] max-h-80 overflow-y-auto bg-surface border border-gray-200 rounded-lg shadow-lg p-2">
      <div className="relative mb-2">
        <MagnifyingGlass className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Wikiページを検索"
          autoFocus
          data-testid="minutes-wiki-link-picker-input"
          className="w-full rounded-lg border border-gray-200 bg-surface py-1.5 pl-7 pr-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      {loading ? (
        <p className="px-2 py-3 text-xs text-gray-400">読み込み中...</p>
      ) : matches.length === 0 ? (
        <p className="px-2 py-3 text-xs text-gray-500">該当するWikiページがありません</p>
      ) : (
        <ul className="space-y-0.5">
          {matches.map((page) => (
            <li key={page.id}>
              <button
                type="button"
                onClick={() => onSelect({ id: page.id, title: page.title })}
                data-testid="minutes-wiki-link-picker-option"
                className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50 rounded transition-colors"
              >
                <FileText className="shrink-0 text-gray-400" />
                <span className="flex-1 min-w-0 truncate">{page.title || '（無題）'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {hiddenCount > 0 && (
        <p className="px-2 pt-1.5 mt-1 border-t border-gray-100 text-xs text-gray-400">
          {`ほか ${hiddenCount} 件。言葉を足すと絞り込めます`}
        </p>
      )}
    </div>
  )
}
