import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchChatworkAccountId } from '@/lib/channels/chatwork/client'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('fetchChatworkAccountId', () => {
  it('GET /v2/me の account_id を文字列で返す（X-ChatWorkToken を送る）', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ account_id: 363, name: 'Bot' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const id = await fetchChatworkAccountId('tok-123')
    expect(id).toBe('363')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.chatwork.com/v2/me')
    expect((init.headers as Record<string, string>)['X-ChatWorkToken']).toBe('tok-123')
  })

  it('401（無効トークン）は null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }))
    expect(await fetchChatworkAccountId('bad')).toBeNull()
  })

  it('account_id 欠如は null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ name: 'x' }) }))
    expect(await fetchChatworkAccountId('tok')).toBeNull()
  })

  it('ネットワーク例外は null（登録は別途ハンドリング）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')))
    expect(await fetchChatworkAccountId('tok')).toBeNull()
  })
})
