import { describe, it, expect } from 'vitest'
import { sortFiles, DEFAULT_FILE_SORT, FILE_SORT_OPTIONS } from '@/lib/files/sort'

const f = (name: string, sizeBytes: number, createdAt: string) => ({ name, sizeBytes, createdAt })

const files = [
  f('b.pdf', 300, '2026-11-02T00:00:00Z'),
  f('A.png', 100, '2026-11-03T00:00:00Z'),
  f('c.csv', 200, '2026-11-01T00:00:00Z'),
  f('ファイル10.txt', 50, '2026-10-01T00:00:00Z'),
  f('ファイル2.txt', 50, '2026-10-02T00:00:00Z'),
]

const names = (list: { name: string }[]) => list.map((x) => x.name)

describe('sortFiles', () => {
  it('既定は新しい順', () => {
    expect(DEFAULT_FILE_SORT).toBe('date_desc')
    expect(names(sortFiles(files, 'date_desc'))).toEqual([
      'A.png', 'b.pdf', 'c.csv', 'ファイル2.txt', 'ファイル10.txt',
    ])
  })

  it('古い順', () => {
    expect(names(sortFiles(files, 'date_asc'))[0]).toBe('ファイル10.txt')
  })

  it('名前順は大文字小文字を区別せず、数字は数の大小で並べる', () => {
    expect(names(sortFiles(files, 'name_asc'))).toEqual([
      'A.png', 'b.pdf', 'c.csv', 'ファイル2.txt', 'ファイル10.txt',
    ])
    expect(names(sortFiles(files, 'name_desc'))[0]).toBe('ファイル10.txt')
  })

  it('サイズ順。同じサイズは新しい順', () => {
    expect(names(sortFiles(files, 'size_desc')).slice(0, 3)).toEqual(['b.pdf', 'c.csv', 'A.png'])
    expect(names(sortFiles(files, 'size_asc')).slice(0, 2)).toEqual(['ファイル2.txt', 'ファイル10.txt'])
  })

  it('元の配列を書き換えない', () => {
    const before = names(files)
    sortFiles(files, 'name_asc')
    expect(names(files)).toEqual(before)
  })

  it('選択肢は6つ', () => {
    expect(FILE_SORT_OPTIONS.map((o) => o.value)).toEqual([
      'date_desc', 'date_asc', 'name_asc', 'name_desc', 'size_desc', 'size_asc',
    ])
  })
})
