import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/connectors/multica/events — 薄いラッパー(line-webhook route と同じ流儀)。
 * 生ボディと X-AgentPM-Signature ヘッダをそのままハンドラへ渡し、結果を返すだけ。
 * 署名は生バイト列に対して検証するため、ここでは JSON パースせず text() で受ける。
 */

const handleMock = vi.fn()
vi.mock('@/lib/connectors/inbound', () => ({
  handleMulticaInboundEvent: (...args: unknown[]) => handleMock(...args),
}))

const { POST } = await import('@/app/api/connectors/multica/events/route')

describe('POST /api/connectors/multica/events', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('生ボディと署名ヘッダをハンドラへ渡す', async () => {
    handleMock.mockResolvedValue({ status: 200, body: { ok: true } })
    const rawBody = '{"event_id":"evt-1","event_type":"task.completed","connection_id":"conn-1","task_ref":"t1"}'
    const request = new NextRequest('http://localhost:3000/api/connectors/multica/events', {
      method: 'POST',
      headers: { 'x-agentpm-signature': 't=1700000000,v1=deadbeef' },
      body: rawBody,
    })

    const response = await POST(request)
    const json = await response.json()

    expect(handleMock).toHaveBeenCalledWith(rawBody, 't=1700000000,v1=deadbeef')
    expect(response.status).toBe(200)
    expect(json).toEqual({ ok: true })
  })

  it('署名ヘッダが無くてもそのままハンドラへ渡す(nullとして)', async () => {
    handleMock.mockResolvedValue({ status: 401, body: { error: 'malformed_header' } })
    const request = new NextRequest('http://localhost:3000/api/connectors/multica/events', {
      method: 'POST',
      body: '{}',
    })

    const response = await POST(request)
    expect(handleMock).toHaveBeenCalledWith('{}', null)
    expect(response.status).toBe(401)
  })

  it('ハンドラの401/404をそのまま返す', async () => {
    handleMock.mockResolvedValue({ status: 404, body: { error: 'unknown_task_ref' } })
    const request = new NextRequest('http://localhost:3000/api/connectors/multica/events', {
      method: 'POST',
      body: '{}',
    })
    const response = await POST(request)
    expect(response.status).toBe(404)
  })

  it('ハンドラ例外でも500を返す(露出しない)', async () => {
    handleMock.mockRejectedValue(new Error('boom'))
    const request = new NextRequest('http://localhost:3000/api/connectors/multica/events', {
      method: 'POST',
      body: '{}',
    })
    const response = await POST(request)
    expect(response.status).toBe(500)
  })
})
