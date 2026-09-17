/**
 * 表データ → CSV/TSV テキスト。parseDelimited の逆変換。
 *
 * 表を直したあとの保存で使う。読み込み(parseDelimited)と対になる純関数で、
 * 「書き出して読み直すと元の表に戻る」ことをテストで守っている。
 *
 * - RFC 4180: 区切り・引用符・改行を含むセルだけ `"` で囲み、`"` は `""` にする
 * - 行区切りは CRLF(Excel で開いたときの既定に合わせる。読む側は LF も CRLF も扱える)
 * - 行の長さは見出しの数にそろえる(短い行は空セル、長い行は切る)
 */

import type { Delimiter, TableData } from './parseDelimited'

/**
 * UTF-8 の目印(BOM)。日本語の CSV を Excel がダブルクリックで開くと、BOM が無いものは
 * Shift_JIS と見なされて文字化けする。保存は必ず BOM 付き UTF-8 で書く。
 */
export const UTF8_BOM = '﻿'

const ROW_SEPARATOR = '\r\n'

function needsQuote(value: string, delimiter: Delimiter): boolean {
  return (
    value.includes(delimiter) ||
    value.includes('"') ||
    value.includes('\n') ||
    value.includes('\r')
  )
}

function quoteCell(value: string, delimiter: Delimiter): string {
  if (!needsQuote(value, delimiter)) return value
  return `"${value.replace(/"/g, '""')}"`
}

export function serializeDelimited(data: TableData, delimiter: Delimiter = ','): string {
  const width = data.columns.length
  if (width === 0) return ''

  const lines: string[] = [data.columns.map((name) => quoteCell(name, delimiter)).join(delimiter)]

  for (const row of data.rows) {
    const cells: string[] = []
    for (let col = 0; col < width; col++) {
      cells.push(quoteCell(row[col] ?? '', delimiter))
    }
    lines.push(cells.join(delimiter))
  }

  return lines.join(ROW_SEPARATOR)
}

/** 保存用のバイト列。BOM 付き UTF-8 で書き出す。 */
export function toCsvBytes(data: TableData, delimiter: Delimiter = ','): Uint8Array {
  return new TextEncoder().encode(UTF8_BOM + serializeDelimited(data, delimiter))
}
