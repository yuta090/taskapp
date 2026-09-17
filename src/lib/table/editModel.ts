/**
 * 表(TableData)を書き換える操作。UI から独立した純関数で、元の表は決して変更しない。
 *
 * 方針:
 * - 何も変わらない操作(同じ値の入力・範囲外の指定)は **同じ TableData をそのまま返す**。
 *   呼び出し側はこれを「変化なし」の合図として使い、保存も再描画も起こさない。
 * - 触っていない行は**同じ配列を使い回す**。巨大な表でも、1セル直しただけで全行が
 *   別物になって再描画されることを避ける(DataTableEditor は行の配列を目印に使う)。
 */

import type { TableData } from './parseDelimited'

/**
 * 新しい列に付ける名前。`position`(0始まり)の位置に入る列として「列N」を付け、
 * その名前が既にあれば空いている番号まで送る。parseDelimited が見出しの無い列に
 * 付ける名前と同じ形にそろえている。
 */
export function nextColumnName(columns: string[], position: number = columns.length): string {
  const taken = new Set(columns)
  let n = Math.max(0, position) + 1
  while (taken.has(`列${n}`)) n++
  return `列${n}`
}

function isRowIndex(data: TableData, rowIndex: number): boolean {
  return Number.isInteger(rowIndex) && rowIndex >= 0 && rowIndex < data.rows.length
}

function isColumnIndex(data: TableData, colIndex: number): boolean {
  return Number.isInteger(colIndex) && colIndex >= 0 && colIndex < data.columns.length
}

/** 見出しの数にそろえた行を返す(足りないセルは空文字)。 */
function padRow(row: string[], width: number): string[] {
  if (row.length >= width) return row.slice(0, width)
  return [...row, ...Array<string>(width - row.length).fill('')]
}

/** 1行だけ差し替えた rows を返す(ほかの行は同じ配列のまま)。 */
function replaceRow(rows: string[][], rowIndex: number, nextRow: string[]): string[][] {
  const next = rows.slice()
  next[rowIndex] = nextRow
  return next
}

export function setCell(data: TableData, rowIndex: number, colIndex: number, value: string): TableData {
  if (!isRowIndex(data, rowIndex) || !isColumnIndex(data, colIndex)) return data

  const row = data.rows[rowIndex]
  if ((row[colIndex] ?? '') === value) return data

  const nextRow = padRow(row, data.columns.length)
  const changed = nextRow === row ? row.slice() : nextRow
  changed[colIndex] = value

  return { columns: data.columns, rows: replaceRow(data.rows, rowIndex, changed) }
}

export function insertRow(data: TableData, at: number): TableData {
  if (!Number.isInteger(at) || at < 0 || at > data.rows.length) return data

  const empty = Array<string>(data.columns.length).fill('')
  const rows = data.rows.slice()
  rows.splice(at, 0, empty)

  return { columns: data.columns, rows }
}

export function deleteRow(data: TableData, at: number): TableData {
  if (!isRowIndex(data, at)) return data

  const rows = data.rows.slice()
  rows.splice(at, 1)

  return { columns: data.columns, rows }
}

export function insertColumn(data: TableData, at: number, name?: string): TableData {
  if (!Number.isInteger(at) || at < 0 || at > data.columns.length) return data

  const columns = data.columns.slice()
  columns.splice(at, 0, name ?? nextColumnName(data.columns, at))

  const width = data.columns.length
  const rows = data.rows.map((row) => {
    const next = padRow(row, width).slice()
    next.splice(at, 0, '')
    return next
  })

  return { columns, rows }
}

export function deleteColumn(data: TableData, at: number): TableData {
  // 最後の1列を消すと、見出しも行も無い「表ではないもの」になってしまう
  if (data.columns.length <= 1 || !isColumnIndex(data, at)) return data

  const columns = data.columns.slice()
  columns.splice(at, 1)

  const width = data.columns.length
  const rows = data.rows.map((row) => {
    const next = padRow(row, width).slice()
    next.splice(at, 1)
    return next
  })

  return { columns, rows }
}

export function renameColumn(data: TableData, at: number, name: string): TableData {
  if (!isColumnIndex(data, at)) return data

  const trimmed = name.trim()
  // 見出しを空にはできない(空の見出しは、読み直したときに「列N」に戻るだけ)
  const nextName = trimmed === '' ? nextColumnName(data.columns, at) : trimmed
  if (data.columns[at] === nextName) return data

  const columns = data.columns.slice()
  columns[at] = nextName

  // 見出しだけの変更なので、行はそのまま使い回す
  return { columns, rows: data.rows }
}
