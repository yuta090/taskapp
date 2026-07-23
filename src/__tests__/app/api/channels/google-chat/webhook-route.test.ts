import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/channels/google-chat/webhook — Bearer JWT 検証 → handler へ委譲。
 * handler 本体は webhookHandler.test.ts で網羅するため、ここは認証境界と配線のみ検証。
 */
const verifyChatAppRequestMock = vi.fn()
vi.mock('@/lib/channels/google-chat/verify', () => ({
  verifyChatAppRequest: (...a: unknown[]) => verifyChatAppRequestMock(...a),
}))

const handleGoogleChatWebhookMock = vi.fn()
vi.mock('@/lib/channels/google-chat/webhookHandler', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>
  return { ...actual, handleGoogleChatWebhook: (...a: unknown[]) => handleGoogleChatWebhookMock(...a) }
})
// store/entitlements/admin は deps 構築時に import されるだけ（handler mock で未実行）。
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))

const { POST } = await import('@/app/api/channels/google-chat/webhook/route')

function post(body: string, headers: Record<string, string> = {}) {
  return POST(
    new NextRequest('http://localhost:3000/api/channels/google-chat/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body,
    }),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  verifyChatAppRequestMock.mockResolvedValue({ ok: true })
  handleGoogleChatWebhookMock.mockResolvedValue({ status: 200, replyText: null })
})

describe('POST /api/channels/google-chat/webhook', () => {
  it('検証成功・replyText有りは {text} を200で返す', async () => {
    handleGoogleChatWebhookMock.mockResolvedValue({ status: 200, replyText: 'このチャンネルを登録しました。' })
    const body = JSON.stringify({ type: 'MESSAGE', space: { name: 'spaces/AAAA' } })
    const res = await post(body, { authorization: 'Bearer good-token' })
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json).toEqual({ text: 'このチャンネルを登録しました。' })
    expect(handleGoogleChatWebhookMock).toHaveBeenCalledTimes(1)
    expect(handleGoogleChatWebhookMock.mock.calls[0][0]).toEqual({
      type: 'MESSAGE',
      space: { name: 'spaces/AAAA' },
    })
  })

  it('検証成功・replyText無しは空の200を返す', async () => {
    const body = JSON.stringify({ type: 'ADDED_TO_SPACE', space: { name: 'spaces/AAAA' } })
    const res = await post(body, { authorization: 'Bearer good-token' })
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json).toEqual({})
  })

  it('env_missing は 500（fail-closed・handlerを呼ばない）', async () => {
    verifyChatAppRequestMock.mockResolvedValue({ ok: false, reason: 'env_missing' })
    const res = await post(JSON.stringify({ type: 'MESSAGE' }), { authorization: 'Bearer x' })
    expect(res.status).toBe(500)
    expect(handleGoogleChatWebhookMock).not.toHaveBeenCalled()
  })

  it('no_token は 401', async () => {
    verifyChatAppRequestMock.mockResolvedValue({ ok: false, reason: 'no_token' })
    const res = await post(JSON.stringify({ type: 'MESSAGE' }))
    expect(res.status).toBe(401)
    expect(handleGoogleChatWebhookMock).not.toHaveBeenCalled()
  })

  it('invalid は 401', async () => {
    verifyChatAppRequestMock.mockResolvedValue({ ok: false, reason: 'invalid' })
    const res = await post(JSON.stringify({ type: 'MESSAGE' }), { authorization: 'Bearer bad' })
    expect(res.status).toBe(401)
    expect(handleGoogleChatWebhookMock).not.toHaveBeenCalled()
  })

  it('検証成功だが本文が不正JSONなら400', async () => {
    const res = await post('{bad', { authorization: 'Bearer good-token' })
    expect(res.status).toBe(400)
    expect(handleGoogleChatWebhookMock).not.toHaveBeenCalled()
  })

  it('handlerが例外を投げたら500', async () => {
    handleGoogleChatWebhookMock.mockRejectedValue(new Error('boom'))
    const res = await post(JSON.stringify({ type: 'MESSAGE' }), { authorization: 'Bearer good-token' })
    expect(res.status).toBe(500)
  })
})
