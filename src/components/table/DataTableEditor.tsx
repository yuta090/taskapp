'use client'

import { useCallback, useDeferredValue, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { MagnifyingGlass, CaretUp, CaretDown, CaretUpDown, Plus, Trash } from '@phosphor-icons/react'
import { useConfirmDialog } from '@/components/shared'
import type { TableData } from '@/lib/table/parseDelimited'
import { sortRows, filterRowsCached, type RowTextCache, type SortDir } from '@/lib/table/tableModel'
import {
  setCell,
  insertRow,
  deleteRow,
  insertColumn,
  deleteColumn,
  renameColumn,
} from '@/lib/table/editModel'

/**
 * 表データ(TableData)のグリッド。見るだけ(editable=false)と直せる状態を**同じ部品**で扱う。
 *
 * - セルをクリックするとその場で書き換えられる。Enter かフォーカスが外れたら確定、Esc で取り消し
 * - 見出しは caret で並べ替え、ダブルクリックで名前の変更、ゴミ箱で列の削除(確認あり)
 * - 保存ボタンは置かない。確定のたびに onChange で新しい表を外へ渡し、保存は呼び出し側が行う
 *
 * 速さのための決めごと(page-perf レビュー):
 * - **書きかけの文字は入力欄の中だけで持つ**(InlineTextInput)。ここで持つと1打鍵ごとに
 *   グリッド全体が作り直される
 * - 検索用の文字列は**行ごとに覚える**(RowTextCache)。1セル直すたびに全行を作り直さない
 * - 列幅は**開いたときの先頭100行**で決めて据え置く。セルを直すたびに幅が動くと表が横に揺れる
 * - 並べ替え・絞り込み中でも直せるよう、書き込む先は**行の配列そのもの**から引く
 *   (見えている順番の番号で書くと、並べ替え中に違う行を書き換えてしまう)
 */

interface DataTableEditorProps {
  data: TableData
  onChange: (next: TableData) => void
  /** false なら見るだけ。並べ替え・検索は使えるが、書き換えの操作は出さない */
  editable?: boolean
}

const ROW_HEIGHT = 36
const ROW_NUMBER_WIDTH = 56
/** 行の削除ボタンを置く右端の幅 */
const ACTION_WIDTH = 40
const MIN_COL_WIDTH = 120
const MAX_COL_WIDTH = 360
/** 列幅を決めるために見るサンプル行数(全行を見ると巨大表で重い) */
const WIDTH_SAMPLE_ROWS = 100
/** 1文字あたりの概算幅(px)。日本語は全角換算で 2 とみなす */
const PX_PER_CHAR = 7.5

interface SortState {
  col: number
  dir: SortDir
}

/** 編集中のセル。行は「元の表での位置」で持つ(並べ替えても指す先が変わらない) */
interface CellEdit {
  rowIndex: number
  col: number
}

function textWidth(text: string): number {
  let units = 0
  for (const ch of text) {
    units += ch.charCodeAt(0) < 0x80 ? 1 : 2
  }
  return units * PX_PER_CHAR
}

function computeColumnWidths(columns: string[], sample: string[][]): number[] {
  return columns.map((name, col) => {
    // 見出しは名前＋並べ替え＋削除ボタンぶんの余白を見込む
    let max = textWidth(name) + 56
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

const CELL_INPUT_CLASS =
  'w-full h-full px-3 text-sm bg-surface text-gray-900 border-2 border-blue-500 focus:outline-none'

/**
 * その場の書き換え用の入力欄。**書きかけの文字はこの中だけで持つ**ので、
 * 打っている間はこの1マスしか描き直されない。
 */
function InlineTextInput({
  initialValue,
  ariaLabel,
  className,
  onCommit,
  onCancel,
}: {
  initialValue: string
  ariaLabel: string
  className: string
  onCommit: (value: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initialValue)
  // Enter で確定した直後に blur が来ても、二重に確定しない
  const doneRef = useRef(false)

  const commit = () => {
    if (doneRef.current) return
    doneRef.current = true
    onCommit(value)
  }
  const cancel = () => {
    if (doneRef.current) return
    doneRef.current = true
    onCancel()
  }

  return (
    <input
      autoFocus
      value={value}
      aria-label={ariaLabel}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') cancel()
      }}
      className={className}
    />
  )
}

export function DataTableEditor({ data, onChange, editable = true }: DataTableEditorProps) {
  const [sort, setSort] = useState<SortState | null>(null)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<CellEdit | null>(null)
  const [editingHeader, setEditingHeader] = useState<number | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const { confirm, ConfirmDialog } = useConfirmDialog()

  // 検索用の文字列の覚え書き。作り直すのは直した行だけ(描画中に ref を書かないよう state で持つ)
  const [searchCache] = useState<RowTextCache>(() => new WeakMap())
  // 列幅は開いたときの先頭100行で決め、以後は列が増減したときだけ計算し直す
  const [widthSample] = useState(() => data.rows.slice(0, WIDTH_SAMPLE_ROWS))

  const actionWidth = editable ? ACTION_WIDTH : 0
  const columnWidths = useMemo(
    () => computeColumnWidths(data.columns, widthSample),
    [data.columns, widthSample]
  )
  const gridTemplate = useMemo(
    () => `${ROW_NUMBER_WIDTH}px ${columnWidths.map((w) => `${w}px`).join(' ')} ${actionWidth}px`,
    [columnWidths, actionWidth]
  )
  const totalWidth = useMemo(
    () => ROW_NUMBER_WIDTH + actionWidth + columnWidths.reduce((a, b) => a + b, 0),
    [columnWidths, actionWidth]
  )

  // 行の配列 → 元の表での位置。並べ替え・絞り込みをしても、書き込む先を取り違えないための対応表
  const rowIndexByRef = useMemo(() => {
    const map = new Map<string[], number>()
    data.rows.forEach((row, idx) => map.set(row, idx))
    return map
  }, [data.rows])

  const deferredQuery = useDeferredValue(query)
  const sortedRows = useMemo(
    () => (sort ? sortRows(data.rows, sort.col, sort.dir) : data.rows),
    [data.rows, sort]
  )
  const visibleRows = useMemo(
    () => filterRowsCached(sortedRows, searchCache, deferredQuery),
    [sortedRows, searchCache, deferredQuery]
  )

  const virtualizer = useVirtualizer({
    count: visibleRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
    scrollMargin: ROW_HEIGHT,
  })

  /** 何も変わらない操作では onChange を呼ばない(保存も再描画も起こさない) */
  const apply = useCallback(
    (next: TableData) => {
      if (next !== data) onChange(next)
    },
    [data, onChange]
  )

  const commitCell = useCallback(
    (value: string) => {
      if (!editing) return
      setEditing(null)
      apply(setCell(data, editing.rowIndex, editing.col, value))
    },
    [apply, data, editing]
  )

  const commitHeader = useCallback(
    (value: string) => {
      if (editingHeader === null) return
      const col = editingHeader
      setEditingHeader(null)
      apply(renameColumn(data, col, value))
    },
    [apply, data, editingHeader]
  )

  const handleDeleteRow = useCallback(
    (rowIndex: number) => {
      setEditing(null)
      apply(deleteRow(data, rowIndex))
    },
    [apply, data]
  )

  const handleDeleteColumn = useCallback(
    async (col: number) => {
      const ok = await confirm({
        title: '列を削除',
        message: `「${data.columns[col]}」の列と、その中身をすべて削除します。この操作は取り消せません。`,
        confirmLabel: '削除',
        variant: 'danger',
      })
      if (!ok) return
      setEditing(null)
      apply(deleteColumn(data, col))
    },
    [apply, confirm, data]
  )

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
        {editable && (
          <div className="ml-auto flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={() => apply(insertRow(data, data.rows.length))}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-700 bg-surface border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <Plus className="text-sm" weight="bold" />
              行を追加
            </button>
            <button
              type="button"
              onClick={() => apply(insertColumn(data, data.columns.length))}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-700 bg-surface border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <Plus className="text-sm" weight="bold" />
              列を追加
            </button>
          </div>
        )}
      </div>

      {/* グリッド本体 */}
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
                  onDoubleClick={
                    editable
                      ? () => {
                          setEditing(null)
                          setEditingHeader(col)
                        }
                      : undefined
                  }
                  className="min-w-0 flex items-center gap-1 px-2 border-r border-gray-100 last:border-r-0"
                >
                  {editingHeader === col ? (
                    <InlineTextInput
                      initialValue={name}
                      ariaLabel="見出しの名前"
                      className={`${CELL_INPUT_CLASS} text-xs font-medium`}
                      onCommit={commitHeader}
                      onCancel={() => setEditingHeader(null)}
                    />
                  ) : (
                    <>
                      <span
                        title={editable ? 'ダブルクリックで名前を変更' : name}
                        className={`truncate text-xs font-medium ${active ? 'text-gray-900' : 'text-gray-600'}`}
                      >
                        {name}
                      </span>
                      <button
                        type="button"
                        aria-label={`${name}で並べ替え`}
                        onClick={() => setSort((s) => nextSort(s, col))}
                        className="ml-auto flex-shrink-0 text-gray-400 hover:text-gray-900 transition-colors"
                      >
                        {active ? (
                          sort.dir === 'asc' ? (
                            <CaretUp className="text-xs" weight="bold" />
                          ) : (
                            <CaretDown className="text-xs" weight="bold" />
                          )
                        ) : (
                          <CaretUpDown className="text-xs" />
                        )}
                      </button>
                      {editable && (
                        <button
                          type="button"
                          aria-label="この列を削除"
                          onClick={() => void handleDeleteColumn(col)}
                          className="flex-shrink-0 text-gray-300 hover:text-red-600 transition-colors"
                        >
                          <Trash className="text-xs" />
                        </button>
                      )}
                    </>
                  )}
                </div>
              )
            })}
            <div role="columnheader" aria-label="行の操作" className="bg-gray-50" />
          </div>

          {/* 行(仮想化) */}
          {total === 0 ? (
            <div className="text-center text-gray-400 text-sm py-16">
              {editable ? '表に行がありません。「行を追加」から書き始められます' : '表に行がありません'}
            </div>
          ) : shown === 0 ? (
            <div className="text-center text-gray-400 text-sm py-16">該当する行がありません</div>
          ) : (
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {virtualizer.getVirtualItems().map((item) => {
                const row = visibleRows[item.index]
                const rowIndex = rowIndexByRef.get(row) ?? item.index
                return (
                  <div
                    key={item.key}
                    role="row"
                    data-testid="table-row"
                    className="grid absolute left-0 right-0 border-b border-gray-100 hover:bg-gray-50 transition-colors"
                    style={{
                      gridTemplateColumns: gridTemplate,
                      height: item.size,
                      transform: `translateY(${item.start - ROW_HEIGHT}px)`,
                    }}
                  >
                    <div
                      data-testid="table-row-number"
                      className="sticky left-0 z-10 flex items-center justify-end px-2 text-[11px] text-gray-400 bg-surface border-r border-gray-200 tabular-nums"
                    >
                      {rowIndex + 1}
                    </div>
                    {data.columns.map((_, col) => {
                      const value = row[col] ?? ''
                      const isEditing = editing?.rowIndex === rowIndex && editing.col === col
                      return (
                        <div
                          key={col}
                          role="cell"
                          title={isEditing ? undefined : value}
                          onClick={
                            editable && !isEditing
                              ? () => setEditing({ rowIndex, col })
                              : undefined
                          }
                          className={`min-w-0 flex items-center text-sm text-gray-900 border-r border-gray-100 ${
                            editable ? 'cursor-text' : ''
                          }`}
                        >
                          {isEditing ? (
                            <InlineTextInput
                              initialValue={value}
                              ariaLabel="セルの中身"
                              className={CELL_INPUT_CLASS}
                              onCommit={commitCell}
                              onCancel={() => setEditing(null)}
                            />
                          ) : (
                            <span className="truncate px-3">{value.split('\n')[0]}</span>
                          )}
                        </div>
                      )
                    })}
                    <div className="flex items-center justify-center">
                      {editable && (
                        <button
                          type="button"
                          aria-label="この行を削除"
                          onClick={() => handleDeleteRow(rowIndex)}
                          className="text-gray-300 hover:text-red-600 transition-colors"
                        >
                          <Trash className="text-sm" />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {ConfirmDialog}
    </div>
  )
}
