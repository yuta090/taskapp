/**
 * CSV/TSV テキスト → 表データ(見出し＋行)。
 *
 * ファイル→表ビュー(読み取り専用)の入口であり、将来の「表をリッチに編集する」機能でも
 * 同じ TableData を編集モデルとして使う想定。ここは純関数に留め、UI や取得と結合しない。
 *
 * - RFC 4180 準拠: 引用符内のカンマ・改行・二重引用符("")を扱う
 * - 区切りは自動判定(カンマ / タブ / セミコロン)
 * - BOM・CRLF を吸収、末尾空行・全セル空の行は捨てる
 * - 行の長さが揃っていなくても、短い行は空セル埋め・長い行は「列N」で見出しを補う
 */

export interface TableData {
  columns: string[]
  rows: string[][]
}

export type Delimiter = ',' | '\t' | ';'

const CANDIDATES: Delimiter[] = [',', '\t', ';']

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/** 1行目(引用符の外側)に最も多く現れる区切り文字を選ぶ。無ければカンマ。 */
export function detectDelimiter(text: string): Delimiter {
  const src = stripBom(text)
  const counts: Record<Delimiter, number> = { ',': 0, '\t': 0, ';': 0 }
  let inQuotes = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (ch === '"') {
      inQuotes = !inQuotes
      continue
    }
    if (inQuotes) continue
    if (ch === '\n' || ch === '\r') break
    if (ch === ',' || ch === '\t' || ch === ';') counts[ch]++
  }
  let best: Delimiter = ','
  for (const d of CANDIDATES) {
    if (counts[d] > counts[best]) best = d
  }
  return best
}

/** 生の行列に切り出す(見出し処理なし)。 */
function tokenize(text: string, delimiter: Delimiter): string[][] {
  const records: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  let i = 0
  const n = text.length

  const endCell = () => {
    row.push(cell)
    cell = ''
  }
  const endRow = () => {
    endCell()
    records.push(row)
    row = []
  }

  while (i < n) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      cell += ch
      i++
      continue
    }
    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }
    if (ch === delimiter) {
      endCell()
      i++
      continue
    }
    if (ch === '\r') {
      endRow()
      i += text[i + 1] === '\n' ? 2 : 1
      continue
    }
    if (ch === '\n') {
      endRow()
      i++
      continue
    }
    cell += ch
    i++
  }
  // 最後の行(改行で終わっていない場合)
  if (cell.length > 0 || row.length > 0) endRow()
  return records
}

function isBlankRow(cells: string[]): boolean {
  return cells.every((c) => c.trim() === '')
}

function padTo(cells: string[], width: number): string[] {
  if (cells.length >= width) return cells
  return [...cells, ...Array<string>(width - cells.length).fill('')]
}

export function parseDelimited(
  text: string,
  options: { delimiter?: Delimiter } = {}
): TableData {
  const src = stripBom(text)
  if (src.trim() === '') return { columns: [], rows: [] }

  const delimiter = options.delimiter ?? detectDelimiter(src)
  const records = tokenize(src, delimiter).filter((r) => !isBlankRow(r))
  if (records.length === 0) return { columns: [], rows: [] }

  const [header, ...body] = records
  // 引数展開(...)は行数ぶんの引数になり 10万行超で RangeError を起こすため、素直に走査する
  let width = header.length
  for (const r of body) if (r.length > width) width = r.length

  const columns = padTo(header, width).map((name, idx) =>
    name.trim() === '' ? `列${idx + 1}` : name
  )
  const rows = body.map((r) => padTo(r, width))

  return { columns, rows }
}
