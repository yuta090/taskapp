import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/connectors/generic/events — 汎用Webhookの受け口（薄いラッパー）。
 *
 * ここで固定したいのは配線だけ:
 *   - **生ボディをそのまま**ハンドラへ渡すこと（署名は生ボディに対して検証するので、
 *     ルートでJSONパースして再シリアライズすると、鍵が正しくても署名が一致しなくなる／
 *     逆に改竄を見逃す）
 *   - 署名ヘッダを渡すこと
 *   - 想定外の例外で内部構造を漏らさないこと
 */

const handleGenericInboundEvent = vi.fn()
vi.mock('@/lib/connectors/genericInbound', () => ({
  handleGenericInboundEvent: (...a: unknown[]) => handleGenericInboundEvent(...a),
}))

const { POST } = await import('@/app/api/connectors/generic/events/route')

const RAW = '{"event_id":"evt-1","connection_id":"c1"}'

function req(raw: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/connectors/generic/events', {
    method: 'POST',
    body: raw,
    headers,
  })
}

beforeEach(() => {
  handleGenericInboundEvent.mockReset().mockResolvedValue({ status: 200, body: { ok: true } })
})

describe('受け口の配線', () => {
  it('生ボディと署名ヘッダをそのまま渡す', async () => {
    await POST(req(RAW, { 'x-agentpm-signature': 't=1,v1=abc' }))
    expect(handleGenericInboundEvent).toHaveBeenCalledWith(RAW, 't=1,v1=abc')
  })

  it('署名ヘッダが無ければ null を渡す（ハンドラ側が401にする）', async () => {
    await POST(req(RAW))
    expect(handleGenericInboundEvent).toHaveBeenCalledWith(RAW, null)
  })

  it('ハンドラの結果をそのまま返す', async () => {
    handleGenericInboundEvent.mockResolvedValue({ status: 404, body: { error: 'unknown external_id' } })
    const res = await POST(req(RAW))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'unknown external_id' })
  })

  it('大きすぎるボディは読む前に413（認証の前にバッファされるため上限が要る）', async () => {
    const res = await POST(req('{}', { 'content-length': String(64 * 1024 + 1) }))
    expect(res.status).toBe(413)
    expect(handleGenericInboundEvent).not.toHaveBeenCalled()
  })

  it('Content-Length を付けない送信側でも実サイズで弾く', async () => {
    const huge = JSON.stringify({ x: 'あ'.repeat(40000) })
    const res = await POST(req(huge))
    expect(res.status).toBe(413)
    expect(handleGenericInboundEvent).not.toHaveBeenCalled()
  })

  it('想定外の例外は理由を返さず500（内部構造を推測させない）', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    handleGenericInboundEvent.mockRejectedValue(new Error('connection string leaked here'))
    const res = await POST(req(RAW))
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('connection string')
    errorSpy.mockRestore()
  })
})
