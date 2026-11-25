/**
 * ファイル一覧の並び替え。絞り込み(filters.ts)と同じく UI から独立した純関数にする。
 * 日付はアップロード日(createdAt)。ファイルに更新日は無い。
 */

export type FileSortKey = 'date_desc' | 'date_asc' | 'name_asc' | 'name_desc' | 'size_desc' | 'size_asc'

export interface SortableFile {
  name: string
  sizeBytes: number
  createdAt: string
}

export const DEFAULT_FILE_SORT: FileSortKey = 'date_desc'

export const FILE_SORT_OPTIONS: Array<{ value: FileSortKey; label: string }> = [
  { value: 'date_desc', label: '新しい順' },
  { value: 'date_asc', label: '古い順' },
  { value: 'name_asc', label: '名前順 (A→Z)' },
  { value: 'name_desc', label: '名前順 (Z→A)' },
  { value: 'size_desc', label: 'サイズが大きい順' },
  { value: 'size_asc', label: 'サイズが小さい順' },
]

// 「ファイル2」が「ファイル10」より前に来るよう numeric を付ける。1つ作って使い回す
const nameCollator = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' })

const byDateDesc = (a: SortableFile, b: SortableFile) =>
  a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0

export function sortFiles<T extends SortableFile>(files: T[], key: FileSortKey): T[] {
  const sorted = [...files]
  switch (key) {
    case 'date_desc':
      return sorted.sort(byDateDesc)
    case 'date_asc':
      return sorted.sort((a, b) => byDateDesc(b, a))
    case 'name_asc':
      return sorted.sort((a, b) => nameCollator.compare(a.name, b.name))
    case 'name_desc':
      return sorted.sort((a, b) => nameCollator.compare(b.name, a.name))
    // 同じサイズのときは新しい順にして、並びが毎回変わらないようにする
    case 'size_desc':
      return sorted.sort((a, b) => b.sizeBytes - a.sizeBytes || byDateDesc(a, b))
    case 'size_asc':
      return sorted.sort((a, b) => a.sizeBytes - b.sizeBytes || byDateDesc(a, b))
  }
}
