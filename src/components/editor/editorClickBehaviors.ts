'use client'

import { useEffect, useRef, type RefObject } from 'react'

/**
 * 文書エディタ（Wiki・議事録）のクリックの足し算。
 *
 * - 折りたたみの題名の文字をクリックしても開閉する（BlockNote は三角のボタンでしか開閉しない）。
 *   カーソルはそのまま題名に入るので、開きながら題名も書き換えられる（Notion と同じ感覚）
 * - 表の列の右の境目をダブルクリックすると、その列でいちばん長い文字に幅を合わせる（Excel と同じ動き）
 */

/** クリックのうち、折りたたみを開閉するかを決めるのに要る分だけ */
interface TitleClick {
  target: EventTarget | null
  button: number
  detail: number
  metaKey?: boolean
  ctrlKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
  defaultPrevented?: boolean
}

/**
 * このクリックで開閉すべき折りたたみの三角のボタンを返す。開閉しないなら null。
 *
 * 開閉しないもの:
 * - 三角のボタンそのもの（BlockNote が自分で開閉する。ここでも押すと二重になる）
 * - 題名の中のリンク（移動を優先する）
 * - 文字をなぞって選んだあと（`selectionCollapsed` が false）。選ぶたびに開閉すると邪魔になる
 * - ダブルクリックの2回目以降。1回目で開閉済みなので、2回目は単語の選択だけにする
 * - 修飾キーつき・左以外のボタン・ほかの処理が止めたクリック
 */
export function resolveToggleButtonForTitleClick(
  event: TitleClick,
  selectionCollapsed: boolean
): HTMLElement | null {
  if (event.defaultPrevented) return null
  if (event.button !== 0 || event.detail > 1) return null
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null
  if (!selectionCollapsed) return null

  const target = event.target
  if (!(target instanceof Element)) return null
  if (target.closest('.bn-toggle-button, .bn-toggle-add-block-button, a[href]')) return null

  // 中身の行は折りたたみの行（.bn-toggle-wrapper）の外に並ぶので、ここに入るのは題名だけ
  const wrapper = target.closest('.bn-toggle-wrapper')
  if (!wrapper) return null
  const button = wrapper.querySelector(':scope > .bn-toggle-button')
  return button instanceof HTMLElement ? button : null
}

/** 境目とみなす、セルの右端からの距離（px）。表の列幅をドラッグで変える仕組みと同じくらいにする */
const EDGE_THRESHOLD = 6

/** 指した位置が、セルの右の境目の上か */
export function isOnColumnRightEdge(clientX: number, cellRight: number, threshold = EDGE_THRESHOLD): boolean {
  return Math.abs(cellRight - clientX) <= threshold
}

/** 幅を合わせるときの下限。BlockNote の列幅の下限（35px）と同じ */
export const AUTO_FIT_MIN_WIDTH = 35
/** 幅を合わせるときの上限。長い説明の列が画面を占めないよう、ここから先は折り返す */
export const AUTO_FIT_MAX_WIDTH = 400

/** 中身の幅（px）の一覧から、列の幅を決める。`extra` はセルの左右の余白と罫線のぶん */
export function computeAutoFitWidth(contentWidths: number[], extra: number): number {
  const longest = contentWidths.length ? Math.max(...contentWidths) : 0
  const width = Math.ceil(longest + extra)
  return Math.min(AUTO_FIT_MAX_WIDTH, Math.max(AUTO_FIT_MIN_WIDTH, width))
}

/** 列幅の一覧のうち、1列だけを差し替えた新しい一覧を返す（幅が無い表でも列の数だけ枠を作る） */
export function withColumnWidth(
  widths: ReadonlyArray<number | undefined>,
  columnCount: number,
  index: number,
  width: number
): (number | undefined)[] {
  const next = Array.from({ length: columnCount }, (_, i) => widths[i])
  next[index] = width
  return next
}

/** セルの中身を折り返さずに並べたときの幅（px）。行ごとに測って、いちばん長い行を返す */
let measureCanvas: HTMLCanvasElement | null = null

function measureCellContent(cell: HTMLElement): number {
  // 測るための canvas は1つを使い回す（押すたびに列のセルの数だけ作らない）
  measureCanvas ??= document.createElement('canvas')
  const ctx = measureCanvas.getContext('2d')
  if (!ctx) return cell.scrollWidth
  const textEl = cell.querySelector('p') ?? cell
  ctx.font = window.getComputedStyle(textEl).font
  const lines = (textEl.textContent ?? '').split('\n')
  return Math.max(0, ...lines.map((line) => ctx.measureText(line).width))
}

/** セルの左右の余白と罫線のぶん（px）。余白は画面の指定から読み、読めなければ既定の見込み */
function cellHorizontalExtra(cell: HTMLElement): number {
  const style = window.getComputedStyle(cell)
  const px = (v: string) => Number.parseFloat(v) || 0
  const extra =
    px(style.paddingLeft) + px(style.paddingRight) + px(style.borderLeftWidth) + px(style.borderRightWidth)
  // 文字の測り方の誤差で最後の1文字が折り返さないよう、少しだけ足す
  return (extra || 20) + 4
}

/** このフックが使う、エディタの操作だけ */
// BlockNote のエディタをそのまま渡せるよう、メソッドの書き方にしている（引数の型を厳しく照合しない）
export interface ClickBehaviorEditor {
  isEditable: boolean
  getBlock(id: string): unknown
  updateBlock(block: never, update: never): unknown
}

interface TableBlockLike {
  type: string
  content?: { type: string; columnWidths?: (number | undefined)[]; rows: { cells: unknown[] }[] }
}

/**
 * 文書エディタの外枠（ref）に、上の2つのクリックを足す。
 *
 * 折りたたみの開閉は読み取り専用でも効かせる（相手先ポータルや閲覧だけの人も開けるように）。
 * 列幅の変更は保存されるので、編集できる人のときだけにする。
 *
 * `measure` はテスト用の差し替え口（jsdom は文字の幅を測れない）。
 */
export function useEditorClickBehaviors(
  containerRef: RefObject<HTMLElement | null>,
  editor: ClickBehaviorEditor,
  measure: (cell: HTMLElement) => number = measureCellContent
) {
  const editorRef = useRef(editor)
  const measureRef = useRef(measure)
  useEffect(() => {
    editorRef.current = editor
    measureRef.current = measure
  }, [editor, measure])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleClick = (event: MouseEvent) => {
      const selection = window.getSelection()
      const button = resolveToggleButtonForTitleClick(event, selection?.isCollapsed ?? true)
      // 既定の動き（カーソルを題名に置く）は止めない。開閉だけを足す
      button?.click()
    }

    const handleDoubleClick = (event: MouseEvent) => {
      const ed = editorRef.current
      if (!ed.isEditable || event.button !== 0) return
      const target = event.target
      if (!(target instanceof Element)) return
      const cell = target.closest('td, th')
      if (!(cell instanceof HTMLTableCellElement)) return
      if (!cell.closest('.bn-block-content[data-content-type="table"]')) return
      if (!isOnColumnRightEdge(event.clientX, cell.getBoundingClientRect().right)) return

      const blockId = cell.closest('[data-id]')?.getAttribute('data-id')
      const table = cell.closest('table')
      if (!blockId || !table) return
      const block = ed.getBlock(blockId) as TableBlockLike | undefined
      if (!block || block.type !== 'table' || block.content?.type !== 'tableContent') return

      const index = cell.cellIndex
      const cells = Array.from(table.rows)
        .map((row) => row.cells[index])
        .filter((c): c is HTMLTableCellElement => !!c)
      const width = computeAutoFitWidth(
        cells.map((c) => measureRef.current(c)),
        cellHorizontalExtra(cell)
      )
      const columnCount = block.content.rows[0]?.cells.length ?? table.rows[0]?.cells.length ?? 0

      // 単語を選ぶ既定の動きは止める（境目を押しただけなので）
      event.preventDefault()
      ed.updateBlock(block as never, {
        type: 'table',
        content: {
          ...block.content,
          columnWidths: withColumnWidth(block.content.columnWidths ?? [], columnCount, index, width),
        },
      } as never)
    }

    container.addEventListener('click', handleClick)
    container.addEventListener('dblclick', handleDoubleClick)
    return () => {
      container.removeEventListener('click', handleClick)
      container.removeEventListener('dblclick', handleDoubleClick)
    }
  }, [containerRef])
}
