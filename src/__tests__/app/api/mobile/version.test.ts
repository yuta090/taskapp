import { describe, expect, it } from 'vitest'
import { GET } from '@/app/api/mobile/version/route'
import { MOBILE_MIN_SUPPORTED_VERSION } from '@/lib/mobile/version'

describe('GET /api/mobile/version', () => {
  it('スマホアプリが対応している最低の版を返す', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ minSupportedVersion: MOBILE_MIN_SUPPORTED_VERSION })
  })

  it('ログイン不要で、短い時間だけキャッシュさせる（版を上げたらすぐ効くように）', async () => {
    const res = await GET()
    expect(res.headers.get('cache-control')).toBe('public, max-age=300')
  })

  it('最低の版は x.y.z の形', () => {
    expect(MOBILE_MIN_SUPPORTED_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
