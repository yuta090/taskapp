/**
 * ファイル一覧の絞り込み。UI から独立した純関数にして、
 * 種類の判定(アイコンと絞り込みの食い違いを防ぐ)もここに一本化する。
 */

import { isTabularFile, TABULAR_EXTENSIONS, TABULAR_MIME_TYPES } from '@/lib/table/tableModel'

/** 'all' は「すべての種類」を表す絞り込み専用の値。ファイル自体がこの種類になることはない。 */
export type FileKind = 'image' | 'pdf' | 'document' | 'table' | 'other'
export type FileKindFilter = FileKind | 'all'
export type FileVisibilityFilter = 'all' | 'visible' | 'hidden'
export type FileOriginFilter = 'all' | 'internal' | 'client'

export interface FileFilterState {
  search: string
  kind: FileKindFilter
  visibility: FileVisibilityFilter
  origin: FileOriginFilter
}

export const EMPTY_FILE_FILTERS: FileFilterState = {
  search: '',
  kind: 'all',
  visibility: 'all',
  origin: 'all',
}

export interface FilterableFile {
  name: string
  mimeType: string
  description?: string | null
  origin: 'internal' | 'client'
  clientVisible: boolean
  uploaderName?: string
}

// MIME が application/octet-stream で届くことがある(CLI・古いブラウザ)ので拡張子でも拾う
const DOCUMENT_MIME_HINTS = [
  'word',
  'document',
  'sheet',
  'excel',
  'presentation',
  'powerpoint',
  'opendocument',
  'rtf',
  'text/plain',
  'text/markdown',
]
const DOCUMENT_EXTENSIONS = [
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.txt', '.md', '.rtf', '.odt', '.ods', '.odp',
  '.pages', '.numbers', '.key',
]
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.heic', '.bmp']
const PDF_EXTENSIONS = ['.pdf']

export function getFileKind(name: string, mimeType: string): FileKind {
  const lowerName = name.toLowerCase()
  const lowerMime = (mimeType || '').toLowerCase()

  // 表(CSV/TSV)が先。text/csv は「テキスト＝書類」にも当たってしまうため
  if (isTabularFile(name, mimeType)) return 'table'
  if (lowerMime.includes('image') || IMAGE_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) return 'image'
  if (lowerMime.includes('pdf') || lowerName.endsWith('.pdf')) return 'pdf'
  if (
    DOCUMENT_MIME_HINTS.some((hint) => lowerMime.includes(hint)) ||
    DOCUMENT_EXTENSIONS.some((ext) => lowerName.endsWith(ext))
  ) {
    return 'document'
  }
  return 'other'
}

/** クライアント提供ファイルは仕様上つねに公開扱い(トグルも無効)。 */
export function isFileClientVisible(file: Pick<FilterableFile, 'clientVisible' | 'origin'>): boolean {
  return file.clientVisible || file.origin === 'client'
}

export function filterFiles<T extends FilterableFile>(files: T[], filters: FileFilterState): T[] {
  const keyword = filters.search.trim().toLowerCase()

  return files.filter((file) => {
    if (keyword) {
      const haystack = [file.name, file.description ?? '', file.uploaderName ?? '']
        .join('\n')
        .toLowerCase()
      if (!haystack.includes(keyword)) return false
    }

    if (filters.kind !== 'all' && getFileKind(file.name, file.mimeType) !== filters.kind) return false

    if (filters.visibility !== 'all') {
      const visible = isFileClientVisible(file)
      if (filters.visibility === 'visible' && !visible) return false
      if (filters.visibility === 'hidden' && visible) return false
    }

    if (filters.origin !== 'all' && file.origin !== filters.origin) return false

    return true
  })
}

export function countActiveFileFilters(filters: FileFilterState): number {
  let count = 0
  if (filters.search.trim()) count++
  if (filters.kind !== 'all') count++
  if (filters.visibility !== 'all') count++
  if (filters.origin !== 'all') count++
  return count
}

export const FILE_KIND_OPTIONS: Array<{ value: FileKindFilter; label: string }> = [
  { value: 'all', label: 'すべての種類' },
  { value: 'table', label: '表(CSV)' },
  { value: 'document', label: '書類' },
  { value: 'pdf', label: 'PDF' },
  { value: 'image', label: '画像' },
  { value: 'other', label: 'その他' },
]

export const FILE_VISIBILITY_OPTIONS: Array<{ value: FileVisibilityFilter; label: string }> = [
  { value: 'all', label: '公開状態すべて' },
  { value: 'visible', label: '公開中' },
  { value: 'hidden', label: '非公開' },
]

export const FILE_ORIGIN_OPTIONS: Array<{ value: FileOriginFilter; label: string }> = [
  { value: 'all', label: '提供元すべて' },
  { value: 'internal', label: '社内から' },
  // 行のバッジ「クライアント提供」と同じ文字にすると、画面上で同じ言葉が別の意味で2つ出るため変える
  { value: 'client', label: 'クライアントから' },
]


/**
 * 500件を超えるスペースでは、絞り込みをサーバー(SQL)側に投げる。
 *
 * SQL 側は「その種類になりうる行を取りこぼさない」ことだけを保証する超集合。
 * 正確な判定は getFileKind が唯一の正で、返ってきた行にクライアントが再度かける。
 * こうしておけば、判定の定義（下の配列）を1か所で直せば両方に効く。
 */
export function getKindMatchPatterns(
  kind: FileKind
): { mimeContains: string[]; nameEndsWith: string[] } | null {
  switch (kind) {
    case 'image':
      return { mimeContains: ['image'], nameEndsWith: IMAGE_EXTENSIONS }
    case 'pdf':
      return { mimeContains: ['pdf'], nameEndsWith: PDF_EXTENSIONS }
    case 'table':
      return { mimeContains: TABULAR_MIME_TYPES, nameEndsWith: TABULAR_EXTENSIONS }
    case 'document':
      return { mimeContains: DOCUMENT_MIME_HINTS, nameEndsWith: DOCUMENT_EXTENSIONS }
    // 「その他」は「どれにも当てはまらない」なので列挙できない。SQLでは絞らず、
    // 返ってきた行にクライアントが getFileKind をかけて narrow する
    case 'other':
      return null
  }
}

/** サーバーに渡す絞り込み条件。効いているものだけを載せる(キャッシュキーを散らかさない) */
export interface ServerFileQuery {
  q?: string
  kind?: FileKind
  visibility?: Exclude<FileVisibilityFilter, 'all'>
  origin?: Exclude<FileOriginFilter, 'all'>
}

export function toServerFileQuery(filters: FileFilterState): ServerFileQuery {
  const query: ServerFileQuery = {}

  const q = filters.search.trim()
  if (q) query.q = q
  if (filters.kind !== 'all' && getKindMatchPatterns(filters.kind)) query.kind = filters.kind
  if (filters.visibility !== 'all') query.visibility = filters.visibility
  if (filters.origin !== 'all') query.origin = filters.origin

  return query
}

/** サーバーに問い合わせる意味があるか(条件が1つも無いなら全件取得のままでよい) */
export function hasServerSearchableCondition(filters: FileFilterState): boolean {
  return Object.keys(toServerFileQuery(filters)).length > 0
}
