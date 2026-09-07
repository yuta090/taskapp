'use client'

import { useDeferredValue, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { MagnifyingGlass, CaretUp, CaretDown, CaretUpDown } from '@phosphor-icons/react'
import type { TableData } from '@/lib/table/parseDelimited'
import { sortRows, buildSearchIndex, filterRowsIndexed, type SortDir } from '@/lib/table/tableModel'

/**
 * 表データ(TableData)を読み取り専用のグリッドで表示する。
 *
 * - 見出しクリックで 昇順 → 降順 → 元の順 に切り替え
 * - 検索欄で全セルを対象に絞り込み(空白区切りは AND)
 * - 行は仮想化(@tanstack/react-virtual)して数千行でも軽く表示
 * - 見出しは上に、行番号は左に固定
 *
 * 将来の「表をリッチに編集する」機能は、このコンポーネントにセル編集を足すのではなく
 * TableData を編集モデルとして扱う別の編集コンポーネントに切り出す想定(ここは表示専用)。
 */

interface DataTableViewProps {
  data: TableData
}

const ROW_HEIGHT = 36
const ROW_NUMBER_WIDTH = 56
const MIN_COL_WIDTH = 96
const MAX_COL_WIDTH = 360
/** 列幅を決めるために見るサンプル行数(全行を見ると巨大表で重い) */
const WIDTH_SAMPLE_ROWS = 100
/** 1文字あたりの概算幅(px)。日本語は全角換算で 2 とみなす */
const PX_PER_CHAR = 7.5

interface SortState {
  col: number
  dir: SortDir
}

function textWidth(text: string): number {
  let units = 0
  for (const ch of text) {
    // 半角(ASCII)は1、それ以外は2として見積もる
    units += ch.charCodeAt(0) < 0x80 ? 1 : 2
  }
  return units * PX_PER_CHAR
}

function computeColumnWidths(data: TableData): number[] {
  const sample = data.rows.slice(0, WIDTH_SAMPLE_ROWS)
  return data.columns.map((name, col) => {
    let max = textWidth(name) + 28 // 並べ替えアイコン分の余白
    for (const row of sample) {
      const firstLine = (row[col] ?? '').split('\n')[0]
      max = Math.max(max, textWidth(firstLine) + 16)
    }
    return Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, Math.ceil(max)))
  })
}

function nextSort(current: SortState | null, col: number): SortState | null {
  if (!current || current.col !== col) return { col, dir: 'asc' }
  if (current.dir === 'asc') return { col, dir: 'desc' }
  return null
}

export function DataTableView({ data }: DataTableViewProps) {
  const [sort, setSort] = useState<SortState | null>(null)
  const [query, setQuery] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  const columnWidths = useMemo(() => computeColumnWidths(data), [data])
  const gridTemplate = useMemo(
    () => `${ROW_NUMBER_WIDTH}px ${columnWidths.map((w) => `${w}px`).join(' ')}`,
    [columnWidths]
  )
  const totalWidth = useMemo(
    () => ROW_NUMBER_WIDTH + columnWidths.reduce((a, b) => a + b, 0),
    [columnWidths]
  )

  // 行配列の参照 → 元の行番号(1始まり)。並べ替え・絞り込み後も元の番号を表示するため
  const rowNumbers = useMemo(() => {
    const map = new Map<string[], number>()
    data.rows.forEach((row, idx) => map.set(row, idx + 1))
    return map
  }, [data.rows])

  // 検索は打鍵ごとに全行を走査するため、入力の反映を遅延させて入力欄の引っかかりを防ぐ
  const deferredQuery = useDeferredValue(query)
  // 行→小文字連結は表データが変わったときだけ作る(打鍵ごとに作り直さない)
  const searchIndex = useMemo(() => buildSearchIndex(data.rows), [data.rows])
  // 並べ替え(重い・稀)と絞り込み(軽い・頻繁)を分け、打鍵で並べ替えが走らないようにする。
  // sortRows は安定ソートなので、並べ替え後に絞り込んでも順序は変わらない
  const sortedRows = useMemo(
    () => (sort ? sortRows(data.rows, sort.col, sort.dir) : data.rows),
    [data.rows, sort]
  )
  const visibleRows = useMemo(
    () => filterRowsIndexed(sortedRows, searchIndex, deferredQuery),
    [sortedRows, searchIndex, deferredQuery]
  )

  const virtualizer = useVirtualizer({
    count: visibleRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
    // 行の入れ物は固定見出し(ROW_HEIGHT)の下から始まる。渡さないと描画対象が1行ぶん下寄りになる
    scrollMargin: ROW_HEIGHT,
  })

  const total = data.rows.length
  const shown = visibleRows.length
  const countLabel = shown === total ? `${total}件` : `${shown}件 / 全${total}件`

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* ツールバー */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-100 flex-shrink-0">
        <div className="relative flex-1 max-w-sm">
          <MagnifyingGlass className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="表の中を検索"
            aria-label="表の中を検索"
            className="w-full pl-8 pr-3 py-1.5 text-sm bg-surface border border-gray-200 rounded-lg text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
          />
        </div>
        <span data-testid="table-row-count" className="text-xs text-gray-500 flex-shrink-0">
          {countLabel}
        </span>
        {sort && (
          <button
            type="button"
            onClick={() => setSort(null)}
            className="text-xs text-gray-500 hover:text-gray-900 underline underline-offset-2 flex-shrink-0"
          >
            並べ替えを解除
          </button>
        )}
      </div>

      {/* グリッド本体 */}
      {total === 0 ? (
        <div className="text-center text-gray-400 text-sm py-16">表に行がありません</div>
      ) : (
        <div ref={scrollRef} className="flex-1 overflow-auto min-h-0" role="table" aria-rowcount={total}>
          <div style={{ width: totalWidth, minWidth: '100%' }}>
            {/* 見出し(上に固定) */}
            <div
              role="row"
              className="sticky top-0 z-20 grid bg-gray-50 border-b border-gray-200"
              style={{ gridTemplateColumns: gridTemplate, height: ROW_HEIGHT }}
            >
              <div
                role="columnheader"
                aria-label="行番号"
                className="sticky left-0 z-30 bg-gray-50 border-r border-gray-200"
              />
              {data.columns.map((name, col) => {
                const active = sort?.col === col
                const ariaSort = active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined
                return (
                  <div
                    key={col}
                    role="columnheader"
                    aria-sort={ariaSort}
                    className="min-w-0 border-r border-gray-100 last:border-r-0"
                  >
                    <button
                      type="button"
                      onClick={() => setSort((s) => nextSort(s, col))}
                      title={`「${name}」で並べ替え`}
                      className={`w-full h-full flex items-center gap-1 px-3 text-left text-xs font-medium truncate transition-colors hover:bg-gray-100 ${
                        active ? 'text-gray-900' : 'text-gray-600'
                      }`}
                    >
                      <span className="truncate">{name}</span>
                      {active ? (
                        sort.dir === 'asc' ? (
                          <CaretUp className="text-xs flex-shrink-0" weight="bold" />
                        ) : (
                          <CaretDown className="text-xs flex-shrink-0" weight="bold" />
                        )
                      ) : (
                        <CaretUpDown className="text-xs flex-shrink-0 text-gray-300" />
                      )}
                    </button>
                  </div>
                )
              })}
            </div>

            {/* 行(仮想化) */}
            {shown === 0 ? (
              <div className="text-center text-gray-400 text-sm py-16">該当する行がありません</div>
            ) : (
              <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
                {virtualizer.getVirtualItems().map((item) => {
                  const row = visibleRows[item.index]
                  const rowNumber = rowNumbers.get(row) ?? item.index + 1
                  return (
                    <div
                      key={item.key}
                      role="row"
                      data-testid="table-row"
                      className="grid absolute left-0 right-0 border-b border-gray-100 hover:bg-gray-50 transition-colors"
                      style={{
                        gridTemplateColumns: gridTemplate,
                        height: item.size,
                        // item.start は scrollMargin(見出し高)を含むので、入れ物内の位置に戻す
                        transform: `translateY(${item.start - ROW_HEIGHT}px)`,
                      }}
                    >
                      <div
                        data-testid="table-row-number"
                        className="sticky left-0 z-10 flex items-center justify-end px-2 text-[11px] text-gray-400 bg-surface border-r border-gray-200 tabular-nums"
                      >
                        {rowNumber}
                      </div>
                      {data.columns.map((_, col) => {
                        const value = row[col] ?? ''
                        return (
                          <div
                            key={col}
                            role="cell"
                            title={value}
                            className="min-w-0 flex items-center px-3 text-sm text-gray-900 truncate border-r border-gray-100 last:border-r-0"
                          >
                            <span className="truncate">{value.split('\n')[0]}</span>
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
