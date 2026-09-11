import { describe, it, expect } from 'vitest'
import { searchWikiPages, createWikiPageSearch, normalizeForSearch } from '@/lib/wiki/pageSearch'

// タスク詳細の「仕様書連携」で、Wikiページを名前で探すための絞り込み。
// 資料が増えても探せるよう、タグの有無に関係なく全ページを対象にする。

type Page = { id: string; title: string; tags: string[] }

function page(id: string, title: string, tags: string[] = []): Page {
  return { id, title, tags }
}

describe('normalizeForSearch', () => {
  it('全角英数・大文字小文字・前後の空白の違いを無視する', () => {
    expect(normalizeForSearch('  ＡＰＩ 仕様書 ')).toBe('api 仕様書')
  })

  it('連続する空白は1つにまとめる', () => {
    expect(normalizeForSearch('議事録　　9月')).toBe('議事録 9月')
  })
})

describe('searchWikiPages', () => {
  const pages = [
    page('p1', '01 事業計画'),
    page('p2', '契約書テンプレート', ['仕様書']),
    page('p3', 'API仕様書', ['仕様書', 'API']),
    page('p4', '9月 定例 議事録'),
    page('p5', 'SQL設計メモ'),
  ]

  it('空の入力では、渡された順（最近更新順）のまま先頭から返す', () => {
    const result = searchWikiPages(pages, '', 3)
    expect(result.matches.map((p) => p.id)).toEqual(['p1', 'p2', 'p3'])
    expect(result.total).toBe(5)
    expect(result.exactMatch).toBeNull()
  })

  it('空白だけの入力は空と同じに扱う', () => {
    const result = searchWikiPages(pages, '   ', 3)
    expect(result.matches.map((p) => p.id)).toEqual(['p1', 'p2', 'p3'])
  })

  it('タグの付いていないページも名前で見つかる', () => {
    const result = searchWikiPages(pages, '事業')
    expect(result.matches.map((p) => p.id)).toEqual(['p1'])
  })

  it('全角・大文字で打っても見つかる', () => {
    expect(searchWikiPages(pages, 'ｓｑｌ').matches.map((p) => p.id)).toEqual(['p5'])
    expect(searchWikiPages(pages, 'api').matches.map((p) => p.id)).toEqual(['p3'])
  })

  it('空白で区切った言葉は、順番に関係なく全部含むページだけ返す', () => {
    expect(searchWikiPages(pages, '議事録 9月').matches.map((p) => p.id)).toEqual(['p4'])
    expect(searchWikiPages(pages, '議事録 10月').matches).toEqual([])
  })

  it('タグでも見つかる', () => {
    const result = searchWikiPages(pages, '仕様書')
    expect(result.matches.map((p) => p.id).sort()).toEqual(['p2', 'p3'])
  })

  it('同じ名前 → 名前が入力で始まる → それ以外の順に出し、同じ順位の中は元の順を保つ', () => {
    const list = [
      page('a', '旧 見積書'),
      page('b', '見積書 v2'),
      page('c', '参考 見積書'),
      page('d', '見積書'),
      page('e', '見積書 v1'),
    ]
    expect(searchWikiPages(list, '見積書').matches.map((p) => p.id)).toEqual(['d', 'b', 'e', 'a', 'c'])
  })

  it('表示件数を超えた分は total で分かる', () => {
    const many = Array.from({ length: 12 }, (_, i) => page(`m${i}`, `議事録 ${i + 1}`))
    const result = searchWikiPages(many, '議事録', 8)
    expect(result.matches).toHaveLength(8)
    expect(result.total).toBe(12)
  })

  it('入力と同じ名前のページがあれば exactMatch に入る（全角・空白の違いは無視）', () => {
    expect(searchWikiPages(pages, '  ａｐｉ仕様書 ').exactMatch?.id).toBe('p3')
  })

  it('名前の一部だけ一致しても exactMatch にはならない', () => {
    expect(searchWikiPages(pages, 'API').exactMatch).toBeNull()
  })

  it('exactMatch は表示件数の外にあっても見つける', () => {
    const many = [
      ...Array.from({ length: 10 }, (_, i) => page(`m${i}`, `議事録 ${i + 1}`)),
      page('x', '議事録'),
    ]
    // 「議事録」で始まるページが並ぶので、完全一致のページが表示件数からあふれることがある
    expect(searchWikiPages(many, '議事録', 3).exactMatch?.id).toBe('x')
  })
})

describe('createWikiPageSearch', () => {
  // 1文字打つたびに全ページの名前を変換し直さないよう、一覧が変わったときに1回だけ下ごしらえする
  it('下ごしらえした一覧で、何度でも searchWikiPages と同じ結果が得られる', () => {
    const pages = [page('p1', '01 事業計画'), page('p2', 'ＡＰＩ仕様書', ['仕様書'])]
    const search = createWikiPageSearch(pages)

    expect(search('事業').matches.map((p) => p.id)).toEqual(['p1'])
    expect(search('api').matches.map((p) => p.id)).toEqual(['p2'])
    expect(search('api仕様書').exactMatch?.id).toBe('p2')
    expect(search('', 1)).toEqual(searchWikiPages(pages, '', 1))
  })
})
