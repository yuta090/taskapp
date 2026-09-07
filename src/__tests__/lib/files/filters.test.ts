import { describe, it, expect } from 'vitest'
import {
  getFileKind,
  filterFiles,
  countActiveFileFilters,
  EMPTY_FILE_FILTERS,
  type FilterableFile,
} from '@/lib/files/filters'

function makeFile(overrides: Partial<FilterableFile> = {}): FilterableFile {
  return {
    name: '要件定義書.pdf',
    mimeType: 'application/pdf',
    description: null,
    origin: 'internal',
    clientVisible: false,
    uploaderName: '田中太郎',
    ...overrides,
  }
}

describe('getFileKind — ファイルの種類判定', () => {
  it('CSV/TSV は「表」として扱う(拡張子でもMIMEでも)', () => {
    expect(getFileKind('顧客一覧.csv', 'text/csv')).toBe('table')
    expect(getFileKind('顧客一覧.csv', 'application/octet-stream')).toBe('table')
    expect(getFileKind('data.tsv', 'text/tab-separated-values')).toBe('table')
  })

  it('画像・PDF を判定する', () => {
    expect(getFileKind('logo.png', 'image/png')).toBe('image')
    expect(getFileKind('契約書.pdf', 'application/pdf')).toBe('pdf')
  })

  it('Word/Excel/PowerPoint/テキストは「書類」にまとめる', () => {
    expect(
      getFileKind('議事録.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    ).toBe('document')
    expect(
      getFileKind('見積.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    ).toBe('document')
    expect(getFileKind('memo.txt', 'text/plain')).toBe('document')
    // MIME が分からなくても拡張子で拾う(CLI 経由は octet-stream になりがち)
    expect(getFileKind('提案書.pptx', 'application/octet-stream')).toBe('document')
  })

  it('それ以外は「その他」', () => {
    expect(getFileKind('archive.zip', 'application/zip')).toBe('other')
  })
})

describe('filterFiles — 絞り込み', () => {
  it('条件なしなら全件そのまま返す', () => {
    const files = [makeFile({ name: 'a.pdf' }), makeFile({ name: 'b.pdf' })]
    expect(filterFiles(files, EMPTY_FILE_FILTERS)).toHaveLength(2)
  })

  it('検索はファイル名にあたる(大文字小文字を区別しない)', () => {
    const files = [makeFile({ name: 'Report.pdf' }), makeFile({ name: '契約書.pdf' })]
    const result = filterFiles(files, { ...EMPTY_FILE_FILTERS, search: 'report' })
    expect(result.map((f) => f.name)).toEqual(['Report.pdf'])
  })

  it('検索は説明文にもあたる', () => {
    const files = [
      makeFile({ name: 'a.pdf', description: '第2四半期の売上まとめ' }),
      makeFile({ name: 'b.pdf', description: null }),
    ]
    const result = filterFiles(files, { ...EMPTY_FILE_FILTERS, search: '売上' })
    expect(result.map((f) => f.name)).toEqual(['a.pdf'])
  })

  it('検索はアップロードした人の名前にもあたる', () => {
    const files = [
      makeFile({ name: 'a.pdf', uploaderName: '田中太郎' }),
      makeFile({ name: 'b.pdf', uploaderName: '佐藤花子' }),
    ]
    const result = filterFiles(files, { ...EMPTY_FILE_FILTERS, search: '佐藤' })
    expect(result.map((f) => f.name)).toEqual(['b.pdf'])
  })

  it('種類で絞り込める', () => {
    const files = [
      makeFile({ name: 'a.pdf', mimeType: 'application/pdf' }),
      makeFile({ name: 'b.csv', mimeType: 'text/csv' }),
    ]
    expect(filterFiles(files, { ...EMPTY_FILE_FILTERS, kind: 'table' }).map((f) => f.name)).toEqual(['b.csv'])
  })

  it('公開状態で絞り込める。クライアント提供ファイルは常に公開中として扱う', () => {
    const files = [
      makeFile({ name: 'hidden.pdf', clientVisible: false, origin: 'internal' }),
      makeFile({ name: 'shown.pdf', clientVisible: true, origin: 'internal' }),
      makeFile({ name: 'fromClient.pdf', clientVisible: false, origin: 'client' }),
    ]
    expect(filterFiles(files, { ...EMPTY_FILE_FILTERS, visibility: 'visible' }).map((f) => f.name)).toEqual([
      'shown.pdf',
      'fromClient.pdf',
    ])
    expect(filterFiles(files, { ...EMPTY_FILE_FILTERS, visibility: 'hidden' }).map((f) => f.name)).toEqual([
      'hidden.pdf',
    ])
  })

  it('提供元で絞り込める', () => {
    const files = [
      makeFile({ name: 'ours.pdf', origin: 'internal' }),
      makeFile({ name: 'theirs.pdf', origin: 'client' }),
    ]
    expect(filterFiles(files, { ...EMPTY_FILE_FILTERS, origin: 'client' }).map((f) => f.name)).toEqual([
      'theirs.pdf',
    ])
  })

  it('複数条件はAND', () => {
    const files = [
      makeFile({ name: '売上.csv', mimeType: 'text/csv', clientVisible: true }),
      makeFile({ name: '売上.pdf', mimeType: 'application/pdf', clientVisible: true }),
      makeFile({ name: '原価.csv', mimeType: 'text/csv', clientVisible: true }),
    ]
    const result = filterFiles(files, {
      ...EMPTY_FILE_FILTERS,
      search: '売上',
      kind: 'table',
      visibility: 'visible',
    })
    expect(result.map((f) => f.name)).toEqual(['売上.csv'])
  })
})

describe('countActiveFileFilters — 効いている条件の数', () => {
  it('条件なしは0', () => {
    expect(countActiveFileFilters(EMPTY_FILE_FILTERS)).toBe(0)
  })

  it('検索の空白だけは条件と数えない', () => {
    expect(countActiveFileFilters({ ...EMPTY_FILE_FILTERS, search: '   ' })).toBe(0)
  })

  it('効いている条件の数を返す', () => {
    expect(
      countActiveFileFilters({ search: '売上', kind: 'table', visibility: 'visible', origin: 'all' })
    ).toBe(3)
  })
})
