import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/channels/google-chat/ingest — OIDC(Pub/Sub push) 検証 → handler へ委譲。
 * handler 本体は ingestHandler.test.ts で網羅するため、ここは認証境界・配線・
 * 「内容起因の失敗は常に200」を検証する。
 */
const verifyPushRequestMock = vi.fn()
vi.mock('@/lib/channels/google-chat/verifyPush', () => ({
  verifyPushRequest: (...a: unknown[]) => verifyPushRequestMock(...a),
}))

const handleGoogleChatIngestMock = vi.fn()
vi.mock('@/lib/channels/google-chat/ingestHandler', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>
  return {
    ...actual,
    handleGoogleChatIngest: (...a: unknown[]) => handleGoogleChatIngestMock(...a),
  }
})
// client/store/admin は deps 構築時に import されるだけ（handler mock で未実行）。
vi.mock('@/lib/channels/google-chat/client', () => ({ sendChatMessage: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))

const { POST } = await import('@/app/api/channels/google-chat/ingest/route')

function post(body: string, headers: Record<string, string> = {}) {
  return POST(
    new NextRequest('http://localhost:3000/api/channels/google-chat/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body,
    }),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  verifyPushRequestMock.mockResolvedValue({ ok: true })
  handleGoogleChatIngestMock.mockResolvedValue({ status: 200 })
})

describe('POST /api/channels/google-chat/ingest', () => {
  it('検証成功は200＋handlerへpushBodyを渡す', async () => {
    const pushBody = { message: { data: 'ZmFrZQ==', messageId: 'm1' }, subscription: 's' }
    const res = await post(JSON.stringify(pushBody), { authorization: 'Bearer good-token' })
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json).toEqual({ ok: true })
    expect(handleGoogleChatIngestMock).toHaveBeenCalledTimes(1)
    expect(handleGoogleChatIngestMock.mock.calls[0][0]).toEqual(pushBody)
  })

  it('env_missing は500（fail-closed・handlerを呼ばない）', async () => {
    verifyPushRequestMock.mockResolvedValue({ ok: false, reason: 'env_missing' })
    const res = await post(JSON.stringify({ message: {} }), { authorization: 'Bearer x' })
    expect(res.status).toBe(500)
    expect(handleGoogleChatIngestMock).not.toHaveBeenCalled()
  })

  it('no_token は401', async () => {
    verifyPushRequestMock.mockResolvedValue({ ok: false, reason: 'no_token' })
    const res = await post(JSON.stringify({ message: {} }))
    expect(res.status).toBe(401)
    expect(handleGoogleChatIngestMock).not.toHaveBeenCalled()
  })

  it('invalid は401', async () => {
    verifyPushRequestMock.mockResolvedValue({ ok: false, reason: 'invalid' })
    const res = await post(JSON.stringify({ message: {} }), { authorization: 'Bearer bad' })
    expect(res.status).toBe(401)
    expect(handleGoogleChatIngestMock).not.toHaveBeenCalled()
  })

  it('検証成功だが本文が不正JSONでも200（内容起因の失敗はPub/Subの再送ループを避けるため握る）', async () => {
    const res = await post('{bad', { authorization: 'Bearer good-token' })
    expect(res.status).toBe(200)
    expect(handleGoogleChatIngestMock).not.toHaveBeenCalled()
  })

  it('handlerが例外を投げても200（内容起因の失敗は握る）', async () => {
    handleGoogleChatIngestMock.mockRejectedValue(new Error('boom'))
    const res = await post(JSON.stringify({ message: {} }), { authorization: 'Bearer good-token' })
    expect(res.status).toBe(200)
  })
})
