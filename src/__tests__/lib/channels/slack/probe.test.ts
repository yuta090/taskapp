import { describe, it, expect, vi } from 'vitest'
import { verifySlackToken } from '@/lib/channels/slack/probe'

function fetchOk(over: { userId?: string; scopes?: string } = {}) {
  const { userId = 'Ubot0000', scopes = 'chat:write,channels:history,groups:history' } = over
  return vi.fn().mockResolvedValue({
    ok: true,
    headers: new Headers({ 'x-oauth-scopes': scopes }),
    json: async () => ({ ok: true, user_id: userId }),
  })
}

describe('verifySlackToken', () => {
  it('auth.test成功＋scope十分ならbotUserIdを返す', async () => {
    const fetchMock = fetchOk()
    const result = await verifySlackToken('xoxb-1', fetchMock)
    expect(result).toEqual({ ok: true, botUserId: 'Ubot0000' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://slack.com/api/auth.test')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer xoxb-1')
  })

  it('groups:historyのみでもread scope充足とみなす（private channel運用）', async () => {
    const fetchMock = fetchOk({ scopes: 'chat:write,groups:history' })
    const result = await verifySlackToken('xoxb-1', fetchMock)
    expect(result.ok).toBe(true)
  })

  it('HTTP非200はtoken_unverified', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers(),
      json: async () => ({}),
    })
    const result = await verifySlackToken('bad', fetchMock)
    expect(result).toEqual({ ok: false, code: 'slack_token_unverified' })
  })

  it('body.ok=falseはtoken_unverified', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'x-oauth-scopes': 'chat:write,channels:history' }),
      json: async () => ({ ok: false, error: 'invalid_auth' }),
    })
    const result = await verifySlackToken('bad', fetchMock)
    expect(result).toEqual({ ok: false, code: 'slack_token_unverified' })
  })

  it('user_id欠如はtoken_unverified', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'x-oauth-scopes': 'chat:write,channels:history' }),
      json: async () => ({ ok: true }),
    })
    const result = await verifySlackToken('tok', fetchMock)
    expect(result).toEqual({ ok: false, code: 'slack_token_unverified' })
  })

  it('ネットワーク例外はtoken_unverified', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('boom'))
    const result = await verifySlackToken('tok', fetchMock)
    expect(result).toEqual({ ok: false, code: 'slack_token_unverified' })
  })

  it('chat:write不足はmissing_scope（不足scope名を含む）', async () => {
    const fetchMock = fetchOk({ scopes: 'channels:history,groups:history' })
    const result = await verifySlackToken('xoxb-1', fetchMock)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('slack_missing_scope')
      expect(result.detail).toContain('chat:write')
    }
  })

  it('read scope(channels:history/groups:history両方)不足はmissing_scope', async () => {
    const fetchMock = fetchOk({ scopes: 'chat:write' })
    const result = await verifySlackToken('xoxb-1', fetchMock)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('slack_missing_scope')
      expect(result.detail).toContain('channels:history')
    }
  })

  it('x-oauth-scopesヘッダ欠如は全scope不足扱いでmissing_scope', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers(),
      json: async () => ({ ok: true, user_id: 'Ubot0000' }),
    })
    const result = await verifySlackToken('xoxb-1', fetchMock)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('slack_missing_scope')
  })
})
