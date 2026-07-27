import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// OGバナー合成用イラスト取得の回帰テスト。
// 失敗系はすべて null(呼び出し側が文字のみバナーへフォールバックし、500を返さない=ISRに乗る)

const fetchMock = vi.fn()

describe('loadOgArtDataUri', () => {
  beforeEach(() => {
    vi.resetModules()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('JPEGを取得してdata URIにする', async () => {
    const buf = new Uint8Array([1, 2, 3]).buffer
    fetchMock.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: () => Promise.resolve(buf),
    })
    const { loadOgArtDataUri } = await import('@/lib/task6/ogArt')
    const out = await loadOgArtDataUri('https://x/c.jpg')
    expect(out).toMatch(/^data:image\/jpeg;base64,/)
  })

  it('非okレスポンスはnull', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, headers: { get: () => 'image/jpeg' } })
    const { loadOgArtDataUri } = await import('@/lib/task6/ogArt')
    expect(await loadOgArtDataUri('https://x/c.jpg')).toBeNull()
  })

  it('png/jpeg以外(webp等)はnull(描画側が非対応)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => 'image/webp' },
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(1)),
    })
    const { loadOgArtDataUri } = await import('@/lib/task6/ogArt')
    expect(await loadOgArtDataUri('https://x/c.webp')).toBeNull()
  })

  it('fetchが例外(タイムアウト等)ならnull', async () => {
    fetchMock.mockRejectedValueOnce(new Error('timeout'))
    const { loadOgArtDataUri } = await import('@/lib/task6/ogArt')
    expect(await loadOgArtDataUri('https://x/c.jpg')).toBeNull()
  })
})

describe('toOgSafeImageUrl', () => {
  it('webpは同名のjpgへ振り替える(シェア画像のWebP非対応サービス対策)', async () => {
    const { toOgSafeImageUrl } = await import('@/lib/task6/ogArt')
    expect(toOgSafeImageUrl('https://x/task6-covers/a-banner.webp')).toBe(
      'https://x/task6-covers/a-banner.jpg',
    )
  })

  it('jpg等はそのまま', async () => {
    const { toOgSafeImageUrl } = await import('@/lib/task6/ogArt')
    expect(toOgSafeImageUrl('https://x/c.jpg')).toBe('https://x/c.jpg')
  })
})
