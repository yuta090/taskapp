import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/leads — LP/contactフォームのリード受付
 *
 * - バリデーション(email/source必須・長さ上限)
 * - honeypot(website)が埋まっていたら保存せず200(botに成功を装う)
 * - IPベースのrate limit → 429
 * - lp_leads へ service role で insert
 * - 通知メールは失敗してもリードは保存されたまま200
 */

const insertMock = vi.fn(() => Promise.resolve({ error: null as { message: string } | null }))
const adminFromMock = vi.fn((table: string) => {
  if (table === 'lp_leads') return { insert: insertMock }
  throw new Error(`unexpected table: ${table}`)
})

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: adminFromMock })),
}))

const sendLeadNotificationEmailMock = vi.fn(() => Promise.resolve())
vi.mock('@/lib/email/lead', () => ({
  sendLeadNotificationEmail: (...args: unknown[]) => sendLeadNotificationEmailMock(...args),
}))

let rateLimitAllowed = true
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(() => ({ allowed: rateLimitAllowed, remaining: 0, retryAfterSeconds: 60 })),
  getClientIp: vi.fn(() => '203.0.113.1'),
}))

const { POST } = await import('@/app/api/leads/route')

function callPost(body: Record<string, unknown>) {
  const request = new NextRequest(new URL('/api/leads', 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(request)
}

const validBody = {
  source: 'lp1',
  email: 'sensei@example.com',
  name: '山田太郎',
  company: '山田会計事務所',
  message: '先行導入の相談をしたい',
}

describe('POST /api/leads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rateLimitAllowed = true
  })

  it('保存して通知メールを送り200を返す', async () => {
    const response = await callPost(validBody)

    expect(response.status).toBe(200)
    expect(insertMock).toHaveBeenCalledTimes(1)
    const row = (insertMock.mock.calls[0] as unknown[])[0] as Record<string, unknown>
    expect(row.source).toBe('lp1')
    expect(row.email).toBe('sensei@example.com')
    expect(row.name).toBe('山田太郎')
    expect(sendLeadNotificationEmailMock).toHaveBeenCalledTimes(1)
  })

  it('emailが無いと400', async () => {
    const response = await callPost({ ...validBody, email: undefined })
    expect(response.status).toBe(400)
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('emailの形式が不正だと400', async () => {
    const response = await callPost({ ...validBody, email: 'not-an-email' })
    expect(response.status).toBe(400)
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('sourceが無いと400', async () => {
    const response = await callPost({ ...validBody, source: undefined })
    expect(response.status).toBe(400)
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('messageが2000文字を超えると400', async () => {
    const response = await callPost({ ...validBody, message: 'あ'.repeat(2001) })
    expect(response.status).toBe(400)
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('honeypotが埋まっていたら保存せず200(成功を装う)', async () => {
    const response = await callPost({ ...validBody, website: 'http://spam.example' })
    expect(response.status).toBe(200)
    expect(insertMock).not.toHaveBeenCalled()
    expect(sendLeadNotificationEmailMock).not.toHaveBeenCalled()
  })

  it('rate limit超過は429で保存しない', async () => {
    rateLimitAllowed = false
    const response = await callPost(validBody)
    expect(response.status).toBe(429)
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('通知メールが失敗してもリードは保存され200', async () => {
    sendLeadNotificationEmailMock.mockRejectedValueOnce(new Error('resend down'))
    const response = await callPost(validBody)
    expect(response.status).toBe(200)
    expect(insertMock).toHaveBeenCalledTimes(1)
  })

  it('insertが失敗したら500', async () => {
    insertMock.mockResolvedValueOnce({ error: { message: 'db down' } })
    const response = await callPost(validBody)
    expect(response.status).toBe(500)
    expect(sendLeadNotificationEmailMock).not.toHaveBeenCalled()
  })
})
