import { describe, it, expect } from 'vitest'
import {
  getKindMatchPatterns,
  hasServerSearchableCondition,
  toServerFileQuery,
  EMPTY_FILE_FILTERS,
} from '@/lib/files/filters'

/**
 * 500件を超えるスペースでは、検索をサーバー側に切り替える。
 * SQL 側は「取りこぼさない（超集合）」ことだけを保証し、
 * 正確な種類判定は getFileKind（唯一の正）でクライアントが再度かける。
 */

describe('getKindMatchPatterns — SQL で広めに拾うためのパターン', () => {
  it('画像は MIME と拡張子の両方で拾う', () => {
    const p = getKindMatchPatterns('image')!
    expect(p.mimeContains).toContain('image')
    expect(p.nameEndsWith).toContain('.png')
  })

  it('表は CSV/TSV の MIME と拡張子で拾う', () => {
    const p = getKindMatchPatterns('table')!
    expect(p.mimeContains).toContain('text/csv')
    expect(p.nameEndsWith).toEqual(expect.arrayContaining(['.csv', '.tsv']))
  })

  it('書類は Office 系の MIME と拡張子で拾う', () => {
    const p = getKindMatchPatterns('document')!
    expect(p.mimeContains).toContain('sheet')
    expect(p.nameEndsWith).toContain('.docx')
  })

  it('「その他」は列挙できないので SQL では絞らない(null)', () => {
    expect(getKindMatchPatterns('other')).toBeNull()
  })

  // 取りこぼしがないこと＝ある種類と判定される実ファイルが、必ずそのパターンに当たること
  it.each([
    ['ロゴ.png', 'image/png', 'image'],
    ['写真.HEIC', 'application/octet-stream', 'image'],
    ['契約書.pdf', 'application/pdf', 'pdf'],
    ['一覧.csv', 'text/csv', 'table'],
    ['一覧.tsv', 'application/octet-stream', 'table'],
    ['議事録.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'document'],
    ['メモ.txt', 'text/plain', 'document'],
  ] as const)('%s は %s のパターンに当たる(取りこぼさない)', (name, mime, kind) => {
    const p = getKindMatchPatterns(kind)!
    const lowerName = name.toLowerCase()
    const lowerMime = mime.toLowerCase()
    const hit =
      p.mimeContains.some((m) => lowerMime.includes(m)) ||
      p.nameEndsWith.some((ext) => lowerName.endsWith(ext))
    expect(hit).toBe(true)
  })
})

describe('hasServerSearchableCondition — サーバーに問い合わせる意味があるか', () => {
  it('条件なしなら問い合わせない', () => {
    expect(hasServerSearchableCondition(EMPTY_FILE_FILTERS)).toBe(false)
  })

  it('空白だけの検索語では問い合わせない', () => {
    expect(hasServerSearchableCondition({ ...EMPTY_FILE_FILTERS, search: '   ' })).toBe(false)
  })

  it('検索語・公開状態・提供元・種類のどれかがあれば問い合わせる', () => {
    expect(hasServerSearchableCondition({ ...EMPTY_FILE_FILTERS, search: '請求' })).toBe(true)
    expect(hasServerSearchableCondition({ ...EMPTY_FILE_FILTERS, visibility: 'visible' })).toBe(true)
    expect(hasServerSearchableCondition({ ...EMPTY_FILE_FILTERS, origin: 'client' })).toBe(true)
    expect(hasServerSearchableCondition({ ...EMPTY_FILE_FILTERS, kind: 'table' })).toBe(true)
  })

  it('SQLで絞れない「その他」だけのときは問い合わせない', () => {
    expect(hasServerSearchableCondition({ ...EMPTY_FILE_FILTERS, kind: 'other' })).toBe(false)
  })
})

describe('toServerFileQuery — 問い合わせに載せる値', () => {
  it('検索語は前後の空白を落とす', () => {
    expect(toServerFileQuery({ ...EMPTY_FILE_FILTERS, search: '  請求  ' })).toEqual({ q: '請求' })
  })

  it('効いている条件だけを載せる(キャッシュキーが無駄に散らからないように)', () => {
    expect(
      toServerFileQuery({ search: '', kind: 'table', visibility: 'visible', origin: 'all' })
    ).toEqual({ kind: 'table', visibility: 'visible' })
  })

  it('SQLで絞れない「その他」は載せない', () => {
    expect(toServerFileQuery({ ...EMPTY_FILE_FILTERS, kind: 'other' })).toEqual({})
  })
})
