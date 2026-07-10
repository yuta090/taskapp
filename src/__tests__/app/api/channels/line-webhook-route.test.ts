import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/channels/line/webhook — 薄いラッパー
 * 生ボディと x-line-signature をそのままハンドラへ渡し、結果を返す
 */

const handleMock = vi.fn()
vi.mock('@/lib/channels/line/webhookHandler', () => ({
  handleLineWebhook: (...args: unknown[]) => handleMock(...args),
}))

const { POST } = await import('@/app/api/channels/line/webhook/route')

describe('POST /api/channels/line/webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('生ボディと署名ヘッダをハンドラへ渡す', async () => {
    handleMock.mockResolvedValue({ status: 200, body: { ok: true } })
    const rawBody = '{"destination":"U1","events":[]}'
    const request = new NextRequest('http://localhost:3000/api/channels/line/webhook', {
      method: 'POST',
      headers: { 'x-line-signature': 'sig-123' },
      body: rawBody,
    })

    const response = await POST(request)

    expect(handleMock).toHaveBeenCalledWith(rawBody, 'sig-123')
    expect(response.status).toBe(200)
  })

  it('ハンドラの401をそのまま返す', async () => {
    handleMock.mockResolvedValue({ status: 401, body: { error: 'invalid signature' } })
    const request = new NextRequest('http://localhost:3000/api/channels/line/webhook', {
      method: 'POST',
      body: '{}',
    })

    const response = await POST(request)
    expect(response.status).toBe(401)
  })

  it('ハンドラ例外でも500を返す（露出しない）', async () => {
    handleMock.mockRejectedValue(new Error('boom'))
    const request = new NextRequest('http://localhost:3000/api/channels/line/webhook', {
      method: 'POST',
      body: '{}',
    })

    const response = await POST(request)
    expect(response.status).toBe(500)
  })
})
