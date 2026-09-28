'use client'

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  MagnifyingGlass,
  CaretUp,
  CaretDown,
  CaretUpDown,
  Plus,
  Trash,
  TextAlignLeft,
} from '@phosphor-icons/react'
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
 * - **行の追加は表の一番下**から(書き足したい場所の近くに置く)
 * - **列の幅**は見出しの境目をドラッグして変えられる(見た目だけ。ファイルの中身は変わらない)
 * - **折り返して表示**に切り替えると、長いセルを同じ列幅のまま全文見せる
 * - 保存ボタンは置かない。確定のたびに onChange で新しい表を外へ渡し、保存は呼び出し側が行う
 *
 * 速さのための決めごと(page-perf レビュー):
 * - **書きかけの文字は入力欄の中だけで持つ**(InlineTextInput)。ここで持つと1打鍵ごとに
 *   グリッド全体が作り直される
 * - 検索用の文字列は**行ごとに覚える**(RowTextCache)。1セル直すたびに全行を作り直さない
 * - 列幅は**開いたときの先頭100行**で決めて据え置く。セルを直すたびに幅が動くと表が横に揺れる
 * - 並べ替え・絞り込み中でも直せるよう、書き込む先は**行の配列そのもの**から引く
 * - 行の高さを測る(measureElement)のは**折り返し表示のときだけ**。1行表示では固定の高さで済ませる
 * - 測った高さは**元の行番号**に結びつける(getItemKey)。既定の「表示位置の番号」だと、
 *   絞り込み・並べ替えのあとに**別の行の高さ**が使われて表が崩れる
 * - **ドラッグ中の幅は CSS 変数へ直接書く**。state にすると、1回動かすごとに表示中の全セルが
 *   作り直される(50列なら約3,000マス)。確定するのは指を離したときだけ
 */

interface DataTableEditorProps {
  data: TableData
  onChange: (next: TableData) => void
  /** false なら見るだけ。並べ替え・検索・折り返しは使えるが、書き換えの操作は出さない */
  editable?: boolean
}

const ROW_HEIGHT = 36
const ROW_NUMBER_WIDTH = 56
/** 行の削除ボタンを置く右端の幅 */
const ACTION_WIDTH = 40
const MIN_COL_WIDTH = 120
const MAX_COL_WIDTH = 360
/** ドラッグで広げられる上限。自動計算の上限より広くしてよい(手で決めたのだから) */
const MAX_DRAG_WIDTH = 800
/** 折り返し表示のときの、行の高さの見積もり(実測が入るまでの仮の値) */
const WRAPPED_ROW_ESTIMATE = 60
/** 列幅を決めるために見るサンプル行数(全行を見ると巨大表で重い) */
const WIDTH_SAMPLE_ROWS = 100
/** 1文字あたりの概算幅(px)。日本語は全角換算で 2 とみなす */
const PX_PER_CHAR = 7.5
/** 行の並びを CSS 変数で配る(ドラッグ中は React を通さずここだけ書き換える) */
const GRID_TEMPLATE_VAR = '--table-grid-template'
const GRID_WIDTH_VAR = '--table-grid-width'

interface SortState {
  col: number
  dir: SortDir
}

/** 編集中のセル。行は「元の表での位置」で持つ(並べ替えても指す先が変わらない) */
interface CellEdit {
  rowIndex: number
  col: number
}

/** 幅を引っぱっている最中の記録 */
interface DragState {
  col: number
  startX: number
  /** つかんだ時点の全列の幅。ドラッグ中はこれを元に組み立てる */
  widths: number[]
  /** 直近の幅。指を離したときに state へ確定する */
  latest: number
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

function templateOf(widths: number[], actionWidth: number): string {
  return `${ROW_NUMBER_WIDTH}px ${widths.map((w) => `${w}px`).join(' ')} ${actionWidth}px`
}

function totalWidthOf(widths: number[], actionWidth: number): number {
  return ROW_NUMBER_WIDTH + actionWidth + widths.reduce((a, b) => a + b, 0)
}

function nextSort(current: SortState | null, col: number): SortState | null {
  if (!current || current.col !== col) return { col, dir: 'asc' }
  if (current.dir === 'asc') return { col, dir: 'desc' }
  return null
}

const CELL_INPUT_CLASS =
  'w-full h-full px-3 text-sm bg-surface text-gray-900 border-2 border-blue-500 focus:outline-none'

const TOOLBAR_BUTTON_CLASS =
  'flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-700 bg-surface border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors'

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
  const [wrap, setWrap] = useState(false)
  /** 手で決めた列幅(列の位置 → px)。見た目だけの話なので、ファイルの中身には書かない */
  const [widthOverrides, setWidthOverrides] = useState<Record<number, number>>({})
  const scrollRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const stopDragRef = useRef<(() => void) | null>(null)
  const { confirm, ConfirmDialog } = useConfirmDialog()

  // 検索用の文字列の覚え書き。作り直すのは直した行だけ(描画中に ref を書かないよう state で持つ)
  const [searchCache] = useState<RowTextCache>(() => new WeakMap())
  // 列幅は開いたときの先頭100行で決め、以後は列が増減したときだけ計算し直す
  const [widthSample] = useState(() => data.rows.slice(0, WIDTH_SAMPLE_ROWS))

  const actionWidth = editable ? ACTION_WIDTH : 0
  const autoWidths = useMemo(
    () => computeColumnWidths(data.columns, widthSample),
    [data.columns, widthSample]
  )
  const columnWidths = useMemo(
    () => autoWidths.map((w, col) => widthOverrides[col] ?? w),
    [autoWidths, widthOverrides]
  )
  const gridTemplate = useMemo(
    () => templateOf(columnWidths, actionWidth),
    [columnWidths, actionWidth]
  )
  const totalWidth = useMemo(
    () => totalWidthOf(columnWidths, actionWidth),
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

  /**
   * getItemKey から読むための控え。描画中に ref を書かないよう、描画のあとに写す。
   * 高さを測るのはマウント後なので、このタイミングで間に合う。
   */
  const lookupRef = useRef<{ rows: string[][]; index: Map<string[], number> }>({
    rows: [],
    index: new Map(),
  })
  useEffect(() => {
    lookupRef.current = { rows: visibleRows, index: rowIndexByRef }
  }, [visibleRows, rowIndexByRef])

  /**
   * 測った高さを**元の行番号**に結びつける。既定(表示位置の番号)のままだと、
   * 絞り込みや並べ替えのあとに別の行の高さが使われて表が崩れる。
   * 参照を固定しないと、描画のたびに測定表を作り直すことになるので useCallback から出さない。
   */
  const getItemKey = useCallback((index: number) => {
    const { rows, index: map } = lookupRef.current
    const row = rows[index]
    const original = row ? map.get(row) : undefined
    return original ?? index
  }, [])

  const virtualizer = useVirtualizer({
    count: visibleRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => (wrap ? WRAPPED_ROW_ESTIMATE : ROW_HEIGHT),
    getItemKey,
    overscan: 20,
    scrollMargin: ROW_HEIGHT,
  })

  /**
   * 折り返しを切り替えたら高さを測り直す。測った高さは残り続けるので、
   * 呼ばないと「1行に戻したのに行がスカスカのまま」になる。
   * 見ていた行が飛ばないよう、切り替える前の先頭行へ戻す。
   */
  const wrapAnchorRef = useRef<number | null>(null)
  useEffect(() => {
    virtualizer.measure()
    const anchor = wrapAnchorRef.current
    wrapAnchorRef.current = null
    if (anchor != null) virtualizer.scrollToIndex?.(anchor, { align: 'start' })
  }, [wrap, virtualizer])

  const toggleWrap = useCallback(() => {
    wrapAnchorRef.current = virtualizer.getVirtualItems()[0]?.index ?? null
    setWrap((w) => !w)
  }, [virtualizer])

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

  /**
   * 行を足す。絞り込み中だと、足した空の行は検索に引っかからず画面に出てこない。
   * 「押したのに何も起きない」に見えるので、検索を解除してから足し、その行まで送る。
   */
  const scrollToEndRef = useRef(false)
  const handleAddRow = useCallback(() => {
    setQuery('')
    scrollToEndRef.current = true
    apply(insertRow(data, data.rows.length))
  }, [apply, data])

  useEffect(() => {
    if (!scrollToEndRef.current) return
    scrollToEndRef.current = false
    if (data.rows.length > 0) virtualizer.scrollToIndex?.(data.rows.length - 1, { align: 'end' })
  }, [data.rows.length, virtualizer])

  /** 列を足す・消すと列の位置がずれるので、手で決めた幅は捨てる(別の列に幅が付くのを防ぐ) */
  const handleAddColumn = useCallback(() => {
    setWidthOverrides({})
    apply(insertColumn(data, data.columns.length))
  }, [apply, data])

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
      setWidthOverrides({})
      apply(deleteColumn(data, col))
    },
    [apply, confirm, data]
  )

  /**
   * 見出しの境目をつかんで幅を変える。
   * 動かしている間は **CSS 変数を直接書き換える**だけにして、React の描き直しを起こさない
   * (state にすると1回動かすごとに表示中の全マスが作り直される)。確定は指を離したとき。
   */
  const startResize = useCallback(
    (col: number, startX: number, widths: number[]) => {
      dragRef.current = { col, startX, widths, latest: widths[col] }

      const onMove = (e: MouseEvent) => {
        const drag = dragRef.current
        if (!drag) return
        const next = Math.round(
          Math.min(
            MAX_DRAG_WIDTH,
            Math.max(MIN_COL_WIDTH, drag.widths[drag.col] + (e.clientX - drag.startX))
          )
        )
        if (next === drag.latest) return
        drag.latest = next
        const preview = drag.widths.slice()
        preview[drag.col] = next
        const grid = gridRef.current
        if (grid) {
          grid.style.setProperty(GRID_TEMPLATE_VAR, templateOf(preview, actionWidth))
          grid.style.setProperty(GRID_WIDTH_VAR, `${totalWidthOf(preview, actionWidth)}px`)
        }
      }

      const stop = () => {
        const drag = dragRef.current
        dragRef.current = null
        stopDragRef.current = null
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', stop)
        if (drag && drag.latest !== drag.widths[drag.col]) {
          setWidthOverrides((prev) => ({ ...prev, [drag.col]: drag.latest }))
        }
      }

      stopDragRef.current = stop
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', stop)
    },
    [actionWidth]
  )

  // ドラッグの途中で画面を離れても、window に付けた見張りを残さない
  useEffect(() => () => stopDragRef.current?.(), [])

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
        <div className="ml-auto flex items-center gap-2 flex-shrink-0">
          {/* 長いセルの見せ方。既定は1行で省略、押すと同じ列幅のまま折り返す */}
          <button
            type="button"
            onClick={toggleWrap}
            aria-pressed={wrap}
            title={wrap ? '1行におさめて表示します' : '長い文字を折り返して全部表示します'}
            className={`${TOOLBAR_BUTTON_CLASS} ${wrap ? 'bg-gray-100 text-gray-900' : ''}`}
          >
            <TextAlignLeft className="text-sm" />
            {wrap ? '1行で表示' : '折り返して表示'}
          </button>
          {editable && (
            <button type="button" onClick={handleAddColumn} className={TOOLBAR_BUTTON_CLASS}>
              <Plus className="text-sm" weight="bold" />
              列を追加
            </button>
          )}
        </div>
      </div>

      {/* グリッド本体 */}
      <div ref={scrollRef} className="flex-1 overflow-auto min-h-0" role="table" aria-rowcount={total}>
        <div
          ref={gridRef}
          data-testid="table-grid"
          style={{
            width: `var(${GRID_WIDTH_VAR})`,
            minWidth: '100%',
            [GRID_TEMPLATE_VAR]: gridTemplate,
            [GRID_WIDTH_VAR]: `${totalWidth}px`,
          } as CSSProperties}
        >
          {/* 見出し(上に固定) */}
          <div
            role="row"
            className="sticky top-0 z-20 grid bg-gray-50 border-b border-gray-200"
            style={{ gridTemplateColumns: `var(${GRID_TEMPLATE_VAR})`, height: ROW_HEIGHT }}
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
                  className="group relative min-w-0 flex items-center gap-1 px-2 border-r border-gray-100 last:border-r-0"
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
                        // 取り消せない操作なので、普段は出さずにその列へ近づいたときだけ出す。
                        // 指で触る画面(md未満)はホバーが無いので、そちらでは出したままにする
                        <button
                          type="button"
                          aria-label="この列を削除"
                          onClick={() => void handleDeleteColumn(col)}
                          className="flex-shrink-0 text-gray-300 hover:text-red-600 transition md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100"
                        >
                          <Trash className="text-xs" />
                        </button>
                      )}
                      {/* 幅を変えるつまみ。見出しの右の境目に重ねる */}
                      <div
                        role="separator"
                        aria-orientation="vertical"
                        aria-label={`「${name}」の幅を変える`}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          startResize(col, e.clientX, columnWidths)
                        }}
                        onDoubleClick={(e) => {
                          // 自動の幅に戻す
                          e.stopPropagation()
                          setWidthOverrides((prev) => {
                            if (prev[col] === undefined) return prev
                            const next = { ...prev }
                            delete next[col]
                            return next
                          })
                        }}
                        title="ドラッグで幅を変える（ダブルクリックで元に戻す）"
                        className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-blue-400/40"
                      />
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
              {editable ? '表に行がありません。下の「行を追加」から書き始められます' : '表に行がありません'}
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
                    data-index={item.index}
                    // 折り返しのときだけ実際の高さを測る(1行表示なら固定の高さで足りる)
                    ref={wrap ? virtualizer.measureElement : undefined}
                    className="grid absolute left-0 right-0 border-b border-gray-100 hover:bg-gray-50 transition-colors"
                    style={{
                      gridTemplateColumns: `var(${GRID_TEMPLATE_VAR})`,
                      height: wrap ? undefined : item.size,
                      minHeight: wrap ? ROW_HEIGHT : undefined,
                      transform: `translateY(${item.start - ROW_HEIGHT}px)`,
                    }}
                  >
                    <div
                      data-testid="table-row-number"
                      className={`sticky left-0 z-10 flex justify-end px-2 text-[11px] text-gray-400 bg-surface border-r border-gray-200 tabular-nums ${
                        wrap ? 'items-start pt-2' : 'items-center'
                      }`}
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
                          title={isEditing || wrap ? undefined : value}
                          onClick={
                            editable && !isEditing
                              ? () => setEditing({ rowIndex, col })
                              : undefined
                          }
                          className={`min-w-0 flex text-sm text-gray-900 border-r border-gray-100 ${
                            wrap ? 'items-start' : 'items-center'
                          } ${editable ? 'cursor-text' : ''}`}
                        >
                          {isEditing ? (
                            <InlineTextInput
                              initialValue={value}
                              ariaLabel="セルの中身"
                              className={CELL_INPUT_CLASS}
                              onCommit={commitCell}
                              onCancel={() => setEditing(null)}
                            />
                          ) : wrap ? (
                            <span className="px-3 py-2 whitespace-pre-wrap break-words">{value}</span>
                          ) : (
                            <span className="truncate px-3">{value.split('\n')[0]}</span>
                          )}
                        </div>
                      )
                    })}
                    <div className={`flex justify-center ${wrap ? 'items-start pt-1.5' : 'items-center'}`}>
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

          {/* 行の追加は表の一番下に置く(書き足したい場所のすぐ下) */}
          {editable && (
            <button
              type="button"
              onClick={handleAddRow}
              className="w-full flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium text-gray-500 border-t border-gray-100 hover:bg-gray-50 hover:text-gray-900 transition-colors"
            >
              <Plus className="text-sm" weight="bold" />
              行を追加
            </button>
          )}
        </div>
      </div>

      {ConfirmDialog}
    </div>
  )
}
