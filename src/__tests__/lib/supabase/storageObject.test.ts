// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { storageObjectUrl, fetchStorageObject } from '@/lib/supabase/storageObject'

/**
 * Storage のオブジェクトの取り出し。supabase-js の download() が上書き直後に古い中身を
 * 返す問題を避けるため、版を付けた URL へ自分で取りにいく。
 */

const SUPABASE_URL = 'https://example.supabase.co'
const BUCKET = 'space-files'
const PATH = 'space-1/file-1/target.csv'

describe('storageObjectUrl', () => {
  it('認証つきオブジェクトの URL を組み立てる', () => {
    expect(storageObjectUrl(SUPABASE_URL, BUCKET, PATH)).toBe(
      `${SUPABASE_URL}/storage/v1/object/authenticated/${BUCKET}/${PATH}`
    )
  })

  it('版を渡すと ?v= を付ける(上書きの前後で別の URL になる)', () => {
    const url = storageObjectUrl(SUPABASE_URL, BUCKET, PATH, '2026-09-17T00:00:00.000Z')
    expect(url).toContain(`${BUCKET}/${PATH}?v=`)
    expect(url).toContain(encodeURIComponent('2026-09-17T00:00:00.000Z'))
  })

  it('版が null・空のときは付けない', () => {
    expect(storageObjectUrl(SUPABASE_URL, BUCKET, PATH, null)).not.toContain('?v=')
    expect(storageObjectUrl(SUPABASE_URL, BUCKET, PATH, '')).not.toContain('?v=')
  })

  it('置き場所の区切り(/)は残し、中の文字だけ URL 用に直す', () => {
    const url = storageObjectUrl(SUPABASE_URL, BUCKET, 'space 1/file#1/a b.csv')
    expect(url).toContain(`${BUCKET}/space%201/file%231/a%20b.csv`)
  })

  it('末尾に / が付いた設定でも URL が二重にならない', () => {
    expect(storageObjectUrl(`${SUPABASE_URL}/`, BUCKET, PATH)).toBe(
      `${SUPABASE_URL}/storage/v1/object/authenticated/${BUCKET}/${PATH}`
    )
  })
})

describe('fetchStorageObject', () => {
  const fetchMock = vi.fn()
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey
    vi.unstubAllGlobals()
  })

  it('版を付けた URL へ、service role の鍵で取りにいく', async () => {
    await fetchStorageObject(BUCKET, PATH, '2026-09-17T00:00:00.000Z')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('?v=')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer service-role-key')
    expect((init.headers as Record<string, string>).apikey).toBe('service-role-key')
  })

  it('間に入るキャッシュを使わない', async () => {
    await fetchStorageObject(BUCKET, PATH, 'v1')
    expect(fetchMock.mock.calls[0][1].cache).toBe('no-store')
  })

  it('設定が足りないときは、鍵を使う前に止める', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    await expect(fetchStorageObject(BUCKET, PATH, 'v1')).rejects.toThrow(/Missing Supabase configuration/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
