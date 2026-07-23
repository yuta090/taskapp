import { describe, it, expect, vi } from 'vitest'
import { verifyTelegramToken } from '@/lib/channels/telegram/probe'

function fetchOk(over: { username?: string; id?: number; canReadAll?: boolean } = {}) {
  const { username = 'my_bot', id = 123456, canReadAll = true } = over
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      ok: true,
      result: { id, username, can_read_all_group_messages: canReadAll },
    }),
  })
}

describe('verifyTelegramToken', () => {
  it('getMe成功＋can_read_all_group_messages:trueならbotUsername/botIdを返す', async () => {
    const fetchMock = fetchOk({ username: 'my_bot', id: 123456 })
    const result = await verifyTelegramToken('123:AAbb', fetchMock)
    expect(result).toEqual({ ok: true, botUsername: 'my_bot', botId: '123456' })
    const [url] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.telegram.org/bot123:AAbb/getMe')
  })

  it('HTTP非200はtoken_unverified', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({}),
    })
    const result = await verifyTelegramToken('bad', fetchMock)
    expect(result).toEqual({ ok: false, code: 'telegram_token_unverified' })
  })

  it('body.ok=falseはtoken_unverified', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false, description: 'Unauthorized' }),
    })
    const result = await verifyTelegramToken('bad', fetchMock)
    expect(result).toEqual({ ok: false, code: 'telegram_token_unverified' })
  })

  it('result欠如はtoken_unverified', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    })
    const result = await verifyTelegramToken('tok', fetchMock)
    expect(result).toEqual({ ok: false, code: 'telegram_token_unverified' })
  })

  it('username空はtoken_unverified', async () => {
    const fetchMock = fetchOk({ username: '' })
    const result = await verifyTelegramToken('tok', fetchMock)
    expect(result).toEqual({ ok: false, code: 'telegram_token_unverified' })
  })

  it('can_read_all_group_messages:falseはprivacy_mode（fail-closed）', async () => {
    const fetchMock = fetchOk({ canReadAll: false })
    const result = await verifyTelegramToken('tok', fetchMock)
    expect(result).toEqual({ ok: false, code: 'telegram_privacy_mode' })
  })

  it('can_read_all_group_messages欠如もprivacy_mode（fail-closed）', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, result: { id: 1, username: 'my_bot' } }),
    })
    const result = await verifyTelegramToken('tok', fetchMock)
    expect(result).toEqual({ ok: false, code: 'telegram_privacy_mode' })
  })

  it('ネットワーク例外はtoken_unverified', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('boom'))
    const result = await verifyTelegramToken('tok', fetchMock)
    expect(result).toEqual({ ok: false, code: 'telegram_token_unverified' })
  })
})
