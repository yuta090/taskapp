import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { verifyAiKey } from '@/lib/ai/client'

/**
 * verifyAiKey — 保存時に APIキーの妥当性をプロバイダーへ安価に疎通確認する。
 * 目的: enabled=true でも「壊れた鍵/無効な鍵」を "設定済み(緑)" に見せない土台。
 * 判定: 200→valid / 401・403→invalid / それ以外(429/5xx/ネットワーク)→unknown（判定不能・punishしない）。
 */
describe('verifyAiKey', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('openai 200 は valid（/v1/models に Bearer で疎通）', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 })
    expect(await verifyAiKey('openai', 'sk-abc')).toBe('valid')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/models')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-abc')
  })

  it('openai 401 は invalid', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401 })
    expect(await verifyAiKey('openai', 'sk-bad')).toBe('invalid')
  })

  it('openai 500 は unknown（判定不能・punishしない）', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 })
    expect(await verifyAiKey('openai', 'sk-abc')).toBe('unknown')
  })

  it('anthropic 200 は valid（x-api-key＋version）', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 })
    expect(await verifyAiKey('anthropic', 'sk-ant-abc')).toBe('valid')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.anthropic.com/v1/models')
    const h = init.headers as Record<string, string>
    expect(h['x-api-key']).toBe('sk-ant-abc')
    expect(h['anthropic-version']).toBeTruthy()
  })

  it('anthropic 403 は invalid', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403 })
    expect(await verifyAiKey('anthropic', 'sk-ant-bad')).toBe('invalid')
  })

  it('未対応provider は unknown（疎通しない）', async () => {
    expect(await verifyAiKey('mystery', 'k')).toBe('unknown')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetch が throw しても unknown（ネットワーク障害でpunishしない）', async () => {
    fetchMock.mockRejectedValue(new Error('network down'))
    expect(await verifyAiKey('openai', 'sk-abc')).toBe('unknown')
  })
})
