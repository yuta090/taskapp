/**
 * 表データに対する並べ替え・絞り込み・対象判定。UI から独立した純関数。
 */

export type SortDir = 'asc' | 'desc'

/**
 * 表として開けるファイルの上限(バイト)。API(content route)と UI の両方でこの値を参照する。
 * Vercel の関数応答サイズ上限(4.5MB)より下に置く(超えると本番だけ 500 になる)。
 */
export const MAX_TABLE_FILE_BYTES = 4 * 1024 * 1024
export const MAX_TABLE_FILE_LABEL = '4MB'

const TABULAR_EXTENSIONS = ['.csv', '.tsv']
const TABULAR_MIME_TYPES = ['text/csv', 'text/tab-separated-values']

export function isTabularFile(name: string, mimeType: string): boolean {
  const lower = name.toLowerCase()
  if (TABULAR_EXTENSIONS.some((ext) => lower.endsWith(ext))) return true
  return TABULAR_MIME_TYPES.includes(mimeType.toLowerCase())
}

/** "1,000" のような桁区切りを許して数値化。数でなければ null。 */
function toNumber(value: string): number | null {
  const s = value.trim().replace(/,/g, '')
  if (s === '') return null
  if (!/^[-+]?\d+(\.\d+)?$/.test(s)) return null
  return Number(s)
}

const collator = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' })

/**
 * 指定列で並べ替えた新しい配列を返す(元配列は変更しない・安定)。
 * - 両方が数なら数値比較、そうでなければ日本語ロケールの文字列比較
 * - 空セルは昇順・降順どちらでも最後
 */
export function sortRows(rows: string[][], colIndex: number, dir: SortDir): string[][] {
  const sign = dir === 'asc' ? 1 : -1
  return rows
    .map((row, idx) => ({ row, idx }))
    .sort((a, b) => {
      const av = a.row[colIndex] ?? ''
      const bv = b.row[colIndex] ?? ''
      const aEmpty = av.trim() === ''
      const bEmpty = bv.trim() === ''
      if (aEmpty && bEmpty) return a.idx - b.idx
      if (aEmpty) return 1
      if (bEmpty) return -1
      const an = toNumber(av)
      const bn = toNumber(bv)
      const cmp = an !== null && bn !== null ? an - bn : collator.compare(av, bv)
      if (cmp === 0) return a.idx - b.idx
      return cmp * sign
    })
    .map(({ row }) => row)
}

function splitTerms(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean)
}

/** 空白区切りの語すべてを、いずれかのセルに含む行だけ返す(大文字小文字を区別しない)。 */
export function filterRows(rows: string[][], query: string): string[][] {
  const terms = splitTerms(query)
  if (terms.length === 0) return rows
  return rows.filter((row) => {
    const joined = row.join(' ').toLowerCase()
    return terms.every((t) => joined.includes(t))
  })
}

/**
 * 行 → 検索用の小文字連結文字列。打鍵ごとに全行の連結を作り直すと数万行で引っかかるため、
 * 表データが変わったときに一度だけ作って使い回す。
 */
export type SearchIndex = Map<string[], string>

export function buildSearchIndex(rows: string[][]): SearchIndex {
  const index: SearchIndex = new Map()
  for (const row of rows) index.set(row, row.join(' ').toLowerCase())
  return index
}

/** buildSearchIndex を使う版の filterRows。index に無い行は都度連結する。 */
export function filterRowsIndexed(rows: string[][], index: SearchIndex, query: string): string[][] {
  const terms = splitTerms(query)
  if (terms.length === 0) return rows
  return rows.filter((row) => {
    const joined = index.get(row) ?? row.join(' ').toLowerCase()
    return terms.every((t) => joined.includes(t))
  })
}
