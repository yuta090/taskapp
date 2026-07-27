import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * OG画像まわりの回帰テスト
 * - loadNotoSansJP: 失敗系はすべて null(呼び出し側がフォールバック描画できる)
 * - getPublishedPostSummary: 公開判定が getPublishedPost と同じ条件で効いていること
 */

// ---- loadNotoSansJP ----

const fetchMock = vi.fn()

describe('loadNotoSansJP', () => {
  beforeEach(() => {
    vi.resetModules()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('css→フォント本体の2段fetchでArrayBufferを返す', async () => {
    const buf = new ArrayBuffer(8)
    fetchMock
      .mockResolvedValueOnce({
        text: () =>
          Promise.resolve("src: url(https://fonts.gstatic.com/f.ttf) format('truetype');"),
      })
      .mockResolvedValueOnce({ ok: true, arrayBuffer: () => Promise.resolve(buf) })

    const { loadNotoSansJP } = await import('@/lib/task6/ogFont')
    const result = await loadNotoSansJP('テスト')
    expect(result).toBe(buf)
  })

  it('cssにttf/otf/woffが無ければnull(woff2しか返らないケース)', async () => {
    fetchMock.mockResolvedValueOnce({
      text: () => Promise.resolve("src: url(https://fonts.gstatic.com/f.woff2) format('woff2');"),
    })
    const { loadNotoSansJP } = await import('@/lib/task6/ogFont')
    expect(await loadNotoSansJP('テスト')).toBeNull()
  })

  it('フォント本体の取得が非okならnull', async () => {
    fetchMock
      .mockResolvedValueOnce({
        text: () =>
          Promise.resolve("src: url(https://fonts.gstatic.com/f.ttf) format('truetype');"),
      })
      .mockResolvedValueOnce({ ok: false, status: 500 })
    const { loadNotoSansJP } = await import('@/lib/task6/ogFont')
    expect(await loadNotoSansJP('テスト')).toBeNull()
  })

  it('fetch例外(タイムアウト等)でもnull', async () => {
    fetchMock.mockRejectedValueOnce(new Error('timeout'))
    const { loadNotoSansJP } = await import('@/lib/task6/ogFont')
    expect(await loadNotoSansJP('テスト')).toBeNull()
  })
})

// ---- getPublishedPostSummary ----

interface ChainCall {
  method: string
  args: unknown[]
}

function makeChain(result: { data: unknown }) {
  const calls: ChainCall[] = []
  const chain = {
    select: (...args: unknown[]) => {
      calls.push({ method: 'select', args })
      return chain
    },
    eq: (...args: unknown[]) => {
      calls.push({ method: 'eq', args })
      return chain
    },
    not: (...args: unknown[]) => {
      calls.push({ method: 'not', args })
      return chain
    },
    lte: (...args: unknown[]) => {
      calls.push({ method: 'lte', args })
      return chain
    },
    maybeSingle: () => Promise.resolve(result),
  }
  return { chain, calls }
}

describe('getPublishedPostSummary', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('公開条件(published・公開日あり・未来日でない)で絞り込む', async () => {
    const { chain, calls } = makeChain({ data: { title: 'T', author_name: 'A', cover_image_url: 'https://x/c.jpg' } })
    vi.doMock('@/lib/supabase/admin', () => ({
      createAdminClient: () => ({ from: () => chain }),
    }))

    const { getPublishedPostSummary } = await import('@/lib/blog/posts')
    const result = await getPublishedPostSummary('some-slug')

    expect(result).toEqual({ title: 'T', author_name: 'A', cover_image_url: 'https://x/c.jpg' })
    // バナー合成用にカバー画像も取得している
    expect(calls).toContainEqual({ method: 'select', args: ['title, author_name, cover_image_url'] })
    expect(calls).toContainEqual({ method: 'eq', args: ['slug', 'some-slug'] })
    expect(calls).toContainEqual({ method: 'eq', args: ['status', 'published'] })
    expect(calls).toContainEqual({ method: 'not', args: ['published_at', 'is', null] })
    expect(calls.some((c) => c.method === 'lte' && c.args[0] === 'published_at')).toBe(true)
  })

  it('該当なしはnull', async () => {
    const { chain } = makeChain({ data: null })
    vi.doMock('@/lib/supabase/admin', () => ({
      createAdminClient: () => ({ from: () => chain }),
    }))

    const { getPublishedPostSummary } = await import('@/lib/blog/posts')
    expect(await getPublishedPostSummary('nope')).toBeNull()
  })
})
