import { describe, it, expect, vi, afterEach } from 'vitest'
import { sendDiscordChannelMessage } from '@/lib/channels/discord/client'

afterEach(() => vi.restoreAllMocks())

describe('sendDiscordChannelMessage', () => {
  it('Bot トークンで channels/{id}/messages に content を POST する', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'msg-1' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = await sendDiscordChannelMessage('bot-token', '108480917', 'こんにちは')
    expect(res.ok).toBe(true)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://discord.com/api/v10/channels/108480917/messages')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bot bot-token')
    expect(JSON.parse(init.body as string)).toEqual({ content: 'こんにちは' })
  })

  it('2000字超は切り詰める', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    await sendDiscordChannelMessage('t', 'c', 'あ'.repeat(2500))
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.content.length).toBeLessThanOrEqual(2000)
  })

  it('非2xx は ok:false（例外にしない）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({}) }))
    const res = await sendDiscordChannelMessage('t', 'c', 'x')
    expect(res.ok).toBe(false)
    expect(res.status).toBe(403)
  })

  it('ネットワーク例外は ok:false', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')))
    const res = await sendDiscordChannelMessage('t', 'c', 'x')
    expect(res.ok).toBe(false)
  })
})
