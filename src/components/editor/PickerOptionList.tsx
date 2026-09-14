'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { MagnifyingGlass } from '@phosphor-icons/react'
// 名前は Wiki 由来だが、中身は「名前とタグで絞り込む」だけの汎用の仕組み
import { createWikiPageSearch } from '@/lib/wiki/pageSearch'

/** 候補に出す最大件数。これを超えた分は「ほか N 件」と伝えて、言葉で絞ってもらう */
const MAX_OPTIONS = 8

/** 一覧が絞り込みに使える形。`title` と、あればタグで探す */
interface Searchable {
  id: string
  title: string
  tags?: string[] | null
}

/** 1件の見た目 */
export interface RenderedOption {
  label: string
  icon?: ReactNode
  /** 右端に薄く出す文字（大きさ・日付など） */
  meta?: string
  /** 名前の右に出す小さなタスク（「社内のみ」など） */
  badge?: string
}

interface PickerOptionListProps<T extends Searchable> {
  placeholder: string
  loading: boolean
  emptyMessage: string
  items: readonly T[]
  renderOption: (item: T) => RenderedOption
  onSelect: (item: T) => void
}

/**
 * リンクのピッカーの「検索欄＋候補の一覧」。**キーボードだけで最後まで行ける**ようにする。
 *
 * 種類（ファイル・Wiki・議事録・タスク）ごとの子から使う。取得は子が持ったままなので、
 * 「選ばれている種類のぶんしか取りに行かない」作りは変わらない。
 *
 * キー操作と読み上げの型は、タスクの仕様書欄（`src/components/task/WikiPageLinkPicker.tsx`）に合わせている。
 * 候補は `tabIndex={-1}` にして Tab で降りられなくする。降りられると、フォーカスが入力欄を
 * 離れて画面全体のショートカット（`useKeyboardShortcuts` は入力欄しか除外しない）が誤って効く。
 */
export function PickerOptionList<T extends Searchable>({
  placeholder,
  loading,
  emptyMessage,
  items,
  renderOption,
  onSelect,
}: PickerOptionListProps<T>) {
  const baseId = useId()
  const listId = `${baseId}-list`
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)

  const search = useMemo(() => createWikiPageSearch(items), [items])
  const { matches, total } = useMemo(() => search(query, MAX_OPTIONS), [search, query])
  const hiddenCount = total - matches.length
  const hasOptions = !loading && matches.length > 0
  // 裏で取り直して件数が減ったとき、無い候補を指したままにしない
  // （Enter が無反応になり、読み上げが実在しない行を指す）
  const activeSafe = matches.length ? Math.min(activeIndex, matches.length - 1) : 0

  const changeQuery = useCallback((next: string) => {
    setQuery(next)
    // 打ち直したら先頭に戻す。前の位置に取り残されると、Enter で思っていない候補が入る
    setActiveIndex(0)
  }, [])

  // 選んでいる候補を一覧の中に入れる。`scrollIntoView` は本文（overflow-y-auto）まで
  // 動かしてパネルごとずれるので、一覧の中だけを動かす
  useEffect(() => {
    const list = listRef.current
    const option = list?.children[activeSafe] as HTMLElement | undefined
    if (!list || !option) return
    const top = option.offsetTop
    const bottom = top + option.offsetHeight
    if (top < list.scrollTop) list.scrollTop = top
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight
  }, [activeSafe, matches])

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // 日本語の変換中のキーは奪わない（確定の Enter で候補を選んでしまわない。Safari は keyCode 229）
    if (event.nativeEvent.isComposing || event.keyCode === 229) return

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setActiveIndex((i) => (matches.length ? (i + 1) % matches.length : 0))
        return
      case 'ArrowUp':
        event.preventDefault()
        setActiveIndex((i) => (matches.length ? (i - 1 + matches.length) % matches.length : 0))
        return
      case 'Enter': {
        event.preventDefault()
        const item = matches[activeSafe]
        if (item) onSelect(item)
        return
      }
      // Escape はパネル全体（InsertLinkControl）が受け持つので、ここでは何もしない
    }
  }

  const activeId = hasOptions ? `${baseId}-option-${activeSafe}` : undefined

  return (
    <>
      <div className="relative mb-2">
        <MagnifyingGlass className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          role="combobox"
          aria-expanded={hasOptions}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          value={query}
          onChange={(e) => changeQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoFocus
          data-testid="app-link-picker-input"
          className="w-full rounded-lg border border-gray-200 bg-surface py-1.5 pl-7 pr-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {loading && <p className="px-2 py-3 text-xs text-gray-400">読み込み中...</p>}
      {!loading && matches.length === 0 && (
        <p className="px-2 py-3 text-xs text-gray-500">{emptyMessage}</p>
      )}

      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        // 押しても検索欄からフォーカスを外さない。外れると ↑↓ と Enter が効かなくなり、
        // 画面全体のショートカット（`?` など）が誤って効く場所にカーソルが移る
        onMouseDown={(e) => e.preventDefault()}
        className="min-h-0 flex-1 space-y-0.5 overflow-y-auto"
      >
        {matches.map((item, index) => {
          const view = renderOption(item)
          const selected = index === activeSafe
          return (
            <li
              key={item.id}
              id={`${baseId}-option-${index}`}
              role="option"
              aria-selected={selected}
              tabIndex={-1}
              data-testid="app-link-picker-option"
              onClick={() => onSelect(item)}
              onMouseEnter={() => setActiveIndex(index)}
              className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-gray-700 transition-colors ${
                selected ? 'bg-gray-100' : ''
              }`}
            >
              {view.icon && <span className="shrink-0 text-gray-400">{view.icon}</span>}
              <span className="min-w-0 flex-1 truncate">{view.label}</span>
              {view.badge && (
                <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
                  {view.badge}
                </span>
              )}
              {view.meta && <span className="shrink-0 text-xs text-gray-400">{view.meta}</span>}
            </li>
          )
        })}
      </ul>

      {hiddenCount > 0 && (
        <p className="mt-1 border-t border-gray-100 px-2 pt-1.5 text-xs text-gray-400">
          {`ほか ${hiddenCount} 件。言葉を足すと絞り込めます`}
        </p>
      )}

      {/* 押し方を書いておかないと、キーで動くことに気づけない（CommandPalette と同じ考え方） */}
      <p className="mt-1 border-t border-gray-100 px-2 pt-1.5 text-[10px] text-gray-400">
        ↑↓ 移動 ・ ↵ 選ぶ ・ esc 閉じる
      </p>
    </>
  )
}
