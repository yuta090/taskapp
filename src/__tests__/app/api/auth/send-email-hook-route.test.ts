import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { Webhook } from 'standardwebhooks'

/**
 * Supabase Send Email Hook の受け口。署名（Standard Webhooks）が正しいときだけ送る。
 * 署名は実際のライブラリで作って検証する（モックしない）。
 */
const sendMock = vi.fn()
vi.mock('@/lib/email/sendAuthEmail', () => ({ sendAuthEmail: sendMock }))

const { POST } = await import('@/app/api/auth/send-email-hook/route')

const SECRET_B64 = Buffer.from('test-secret-32-bytes-long-aaaaaaa').toString('base64')
const payload = JSON.stringify({
  user: { id: 'u1', email: 'user@example.com' },
  email_data: { token: '123456', token_hash: 'h4sh', redirect_to: 'https://agentpm.app/', email_action_type: 'signup' },
})

function signedRequest(body: string, secretB64 = SECRET_B64, overrideHeaders: Record<string, string> = {}) {
  const wh = new Webhook(secretB64)
  const id = 'msg_1'
  const ts = new Date()
  const signature = wh.sign(id, ts, body)
  return new NextRequest('http://localhost:3000/api/auth/send-email-hook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'webhook-id': id,
      'webhook-timestamp': String(Math.floor(ts.getTime() / 1000)),
      'webhook-signature': signature,
      ...overrideHeaders,
    },
    body,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  sendMock.mockResolvedValue({ success: true, templateKey: 'auth_signup' })
  process.env.SEND_EMAIL_HOOK_SECRET = `v1,whsec_${SECRET_B64}`
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('POST /api/auth/send-email-hook', () => {
  it('正しい署名なら sendAuthEmail に payload を渡して 200 {}', async () => {
    const res = await POST(signedRequest(payload))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({})
    expect(sendMock).toHaveBeenCalledTimes(1)
    expect((sendMock.mock.calls[0][0] as { email_data: { email_action_type: string } }).email_data.email_action_type).toBe('signup')
  })

  it('秘密の前置き v1,whsec_ が無くても検証できる', async () => {
    process.env.SEND_EMAIL_HOOK_SECRET = SECRET_B64
    expect((await POST(signedRequest(payload))).status).toBe(200)
  })

  it('署名が違えば 401 で送らない', async () => {
    const other = Buffer.from('another-secret-another-secret-xx').toString('base64')
    const res = await POST(signedRequest(payload, other))
    expect(res.status).toBe(401)
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('本文が改ざんされていれば 401', async () => {
    const req = signedRequest(payload)
    const tampered = new NextRequest(req.url, { method: 'POST', headers: req.headers, body: payload.replace('user@example.com', 'evil@example.com') })
    expect((await POST(tampered)).status).toBe(401)
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('署名ヘッダが欠けていれば 401', async () => {
    const res = await POST(signedRequest(payload, SECRET_B64, { 'webhook-signature': '' }))
    expect(res.status).toBe(401)
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('6分前の timestamp は 401（リプレイ対策・許容は前後5分）', async () => {
    const wh = new Webhook(SECRET_B64)
    const old = new Date(Date.now() - 6 * 60 * 1000)
    const req = new NextRequest('http://localhost:3000/api/auth/send-email-hook', {
      method: 'POST',
      headers: { 'webhook-id': 'msg_old', 'webhook-timestamp': String(Math.floor(old.getTime() / 1000)), 'webhook-signature': wh.sign('msg_old', old, payload) },
      body: payload,
    })
    expect((await POST(req)).status).toBe(401)
  })

  it('複数署名（v2,junk v1,good）は正しい v1 があれば 200', async () => {
    const wh = new Webhook(SECRET_B64)
    const ts = new Date()
    const good = wh.sign('msg_multi', ts, payload)
    const req = new NextRequest('http://localhost:3000/api/auth/send-email-hook', {
      method: 'POST',
      headers: { 'webhook-id': 'msg_multi', 'webhook-timestamp': String(Math.floor(ts.getTime() / 1000)), 'webhook-signature': `v2,junk ${good}` },
      body: payload,
    })
    expect((await POST(req)).status).toBe(200)
  })

  it('秘密の形式が不正（base64 でない）なら 503 で「署名不一致」と区別する', async () => {
    process.env.SEND_EMAIL_HOOK_SECRET = 'v1,whsec_%%%not-base64%%%'
    const res = await POST(signedRequest(payload))
    expect(res.status).toBe(503)
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('秘密が未設定なら 503（黙って送らない）', async () => {
    delete process.env.SEND_EMAIL_HOOK_SECRET
    expect((await POST(signedRequest(payload))).status).toBe(503)
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('宛先や種類が無い payload は 400', async () => {
    const bad = JSON.stringify({ user: {}, email_data: {} })
    expect((await POST(signedRequest(bad))).status).toBe(400)
  })

  it('送信に失敗したら 500（Supabase 側にエラーを返す）', async () => {
    sendMock.mockRejectedValue(new Error('resend down'))
    const res = await POST(signedRequest(payload))
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('resend down')
  })
})
