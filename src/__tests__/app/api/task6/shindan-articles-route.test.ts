import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { articleSlugsForType } from '@/lib/task6/shindanArticles'

/**
 * GET /api/task6/shindan-articles?type=t6
 *
 * 診断結果の画面（クライアント）から、そのタイプに効くTASK6記事を引く公開エンドポイント。
 * 記事は blog_posts にあり公開状態が変わるため、**公開済みだけ**を返す（未公開slugが
 * 対応表に載っていてもリンクが出ない＝リンク切れが構造的に起きない）。
 */

let rows: Array<{ slug: string; title: string; description: string | null }> = []
let queryError: { message: string } | null = null
const capturedFilters: Record<string, unknown> = {}

const inMock = vi.fn((column: string, values: string[]) => {
  capturedFilters.inColumn = column
  capturedFilters.inValues = values
  return builder
})
const eqMock = vi.fn((column: string, value: unknown) => {
  capturedFilters[column] = value
  return builder
})
const notMock = vi.fn(() => builder)
const lteMock = vi.fn(() => Promise.resolve({ data: queryError ? null : rows, error: queryError }))
const builder: Record<string, unknown> = {
  select: vi.fn(() => builder),
  in: inMock,
  eq: eqMock,
  not: notMock,
  lte: lteMock,
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: vi.fn(() => builder) }),
}))

async function callRoute(url: string) {
  const { GET } = await import('@/app/api/task6/shindan-articles/route')
  return GET(new NextRequest(url))
}

beforeEach(() => {
  rows = []
  queryError = null
  vi.clearAllMocks()
})

describe('GET /api/task6/shindan-articles', () => {
  it('タイプ指定が無い/知らないタイプは400（DBを叩かない）', async () => {
    const res = await callRoute('https://example.com/api/task6/shindan-articles')
    expect(res.status).toBe(400)

    const res2 = await callRoute('https://example.com/api/task6/shindan-articles?type=t99')
    expect(res2.status).toBe(400)
  })

  it('公開済みの記事だけを、対応表の順（主処方が先頭）で返す', async () => {
    const slugs = articleSlugsForType('t6')
    expect(slugs.length).toBeGreaterThan(0) // 対応表が空だとこのテストが意味を失うため先に確かめる

    // DBは順不同で返す前提。対応表の順に並べ直すのはこちらの責務。
    rows = [...slugs].reverse().map((slug) => ({ slug, title: `${slug} の記事`, description: null }))

    const res = await callRoute('https://example.com/api/task6/shindan-articles?type=t6')
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.posts.map((p: { slug: string }) => p.slug)).toEqual(slugs)
    // 候補slugだけを問い合わせ、公開済みに絞っている（未公開・予約投稿を出さない）
    expect(capturedFilters.inColumn).toBe('slug')
    expect(capturedFilters.inValues).toEqual(slugs)
    expect(capturedFilters.status).toBe('published')
  })

  it('候補が1本も公開されていなければ空配列（200のまま・画面側が何も出さない）', async () => {
    rows = []
    const res = await callRoute('https://example.com/api/task6/shindan-articles?type=t1')
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.posts).toEqual([])
  })

  it('DBエラーでも500にせず空で返す（診断結果の画面を壊さない）', async () => {
    queryError = { message: 'db down' }
    const res = await callRoute('https://example.com/api/task6/shindan-articles?type=t1')
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.posts).toEqual([])
  })
})
