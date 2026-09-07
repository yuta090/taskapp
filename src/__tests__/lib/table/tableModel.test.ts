import { describe, it, expect } from 'vitest'
import { sortRows, filterRows, buildSearchIndex, filterRowsIndexed, isTabularFile, MAX_TABLE_FILE_BYTES } from '@/lib/table/tableModel'

describe('sortRows', () => {
  const rows = [
    ['B社', '10', ''],
    ['A社', '2', '2025-08-28'],
    ['C社', '', '2021-11-08'],
  ]

  it('文字列は日本語ロケールで昇順・降順に並べる', () => {
    expect(sortRows(rows, 0, 'asc').map((r) => r[0])).toEqual(['A社', 'B社', 'C社'])
    expect(sortRows(rows, 0, 'desc').map((r) => r[0])).toEqual(['C社', 'B社', 'A社'])
  })

  it('数値の列は数として並べ、空セルは常に最後にする', () => {
    expect(sortRows(rows, 1, 'asc').map((r) => r[1])).toEqual(['2', '10', ''])
    expect(sortRows(rows, 1, 'desc').map((r) => r[1])).toEqual(['10', '2', ''])
  })

  it('桁区切りカンマ付きも数として扱う', () => {
    const r = [['1,000'], ['999'], ['20']]
    expect(sortRows(r, 0, 'asc').map((x) => x[0])).toEqual(['20', '999', '1,000'])
  })

  it('元の配列を変更しない(安定ソート)', () => {
    const copy = rows.map((r) => [...r])
    sortRows(rows, 0, 'asc')
    expect(rows).toEqual(copy)
  })
})

describe('filterRows', () => {
  const rows = [
    ['ＪＦＥスチール株式会社', '広島県', 'A候補'],
    ['アースサポート株式会社', '島根県', 'B候補'],
    ['Rogue', '広島県', 'C候補'],
  ]

  it('空の検索語は全行を返す', () => {
    expect(filterRows(rows, '   ')).toHaveLength(3)
  })

  it('どのセルかに含まれる行だけ返す(大文字小文字は区別しない)', () => {
    expect(filterRows(rows, 'rogue')).toEqual([rows[2]])
    expect(filterRows(rows, '広島')).toHaveLength(2)
  })

  it('空白区切りの複数語は AND 条件', () => {
    expect(filterRows(rows, '広島 A候補')).toEqual([rows[0]])
  })
})

describe('isTabularFile', () => {
  it('拡張子 .csv / .tsv を表として扱う', () => {
    expect(isTabularFile('list.csv', 'application/octet-stream')).toBe(true)
    expect(isTabularFile('LIST.CSV', '')).toBe(true)
    expect(isTabularFile('data.tsv', '')).toBe(true)
  })
  it('MIME が text/csv なら拡張子が無くても表として扱う', () => {
    expect(isTabularFile('export', 'text/csv')).toBe(true)
  })
  it('PDF や画像は表ではない', () => {
    expect(isTabularFile('a.pdf', 'application/pdf')).toBe(false)
    expect(isTabularFile('a.png', 'image/png')).toBe(false)
    expect(isTabularFile('a.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe(false)
  })
})

describe('MAX_TABLE_FILE_BYTES', () => {
  it('表として開ける上限は 4MB(Vercel の応答サイズ上限 4.5MB より下)', () => {
    expect(MAX_TABLE_FILE_BYTES).toBe(4 * 1024 * 1024)
  })
})

describe('buildSearchIndex / filterRowsIndexed', () => {
  const rows = [
    ['ＪＦＥスチール株式会社', '広島県', 'A候補'],
    ['Rogue', '広島県', 'C候補'],
  ]
  it('行ごとの検索用文字列を一度作り、以後の絞り込みで使い回せる', () => {
    const index = buildSearchIndex(rows)
    expect(index.get(rows[1])).toBe('rogue 広島県 c候補')
    expect(filterRowsIndexed(rows, index, 'ROGUE')).toEqual([rows[1]])
    expect(filterRowsIndexed(rows, index, '広島 a候補')).toEqual([rows[0]])
    expect(filterRowsIndexed(rows, index, '')).toEqual(rows)
  })
})
