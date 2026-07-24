import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/task6/leads — TASK6 テンプレ配布のリード受付（中間CV）
 *
 * - バリデーション(email必須・カタログに存在するtemplateKey必須)
 * - honeypot(website)が埋まっていたら保存せず200(botに成功を装う)
 * - IPベースのrate limit → 429
 * - template_leads へ service role で insert（emailは小文字化して保存）
 * - 重複登録(23505)はエラーにせず last_requested_at を更新して再送
 * - 配布は非公開Storageの署名URLを本人宛メールで送る
 * - 本人宛メールが失敗したら downloadUrl をレスポンスで返すフォールバック
 * - 運営者通知メールは失敗してもリードは保存されたまま200
 */

const insertMock = vi.fn(() =>
  Promise.resolve({ error: null as { message: string; code?: string } | null })
)
const updateEqEqMock = vi.fn(() => Promise.resolve({ error: null }))
const updateMock = vi.fn(() => ({
  eq: () => ({ eq: updateEqEqMock }),
}))
const adminFromMock = vi.fn((table: string) => {
  if (table === 'template_leads') return { insert: insertMock, update: updateMock }
  throw new Error(`unexpected table: ${table}`)
})

const createSignedUrlMock = vi.fn(() =>
  Promise.resolve({
    data: { signedUrl: 'https://storage.example/signed-url' } as { signedUrl: string } | null,
    error: null as { message: string } | null,
  })
)
const storageFromMock = vi.fn((bucket: string) => {
  if (bucket === 'task6-templates') return { createSignedUrl: createSignedUrlMock }
  throw new Error(`unexpected bucket: ${bucket}`)
})

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: adminFromMock, storage: { from: storageFromMock } })),
}))

const sendTemplateDownloadEmailMock = vi.fn((..._args: unknown[]) => Promise.resolve())
vi.mock('@/lib/email/templateDownload', () => ({
  sendTemplateDownloadEmail: (...args: unknown[]) => sendTemplateDownloadEmailMock(...args),
}))

const sendLeadNotificationEmailMock = vi.fn((..._args: unknown[]) => Promise.resolve())
vi.mock('@/lib/email/lead', () => ({
  sendLeadNotificationEmail: (...args: unknown[]) => sendLeadNotificationEmailMock(...args),
}))

let rateLimitAllowed = true
let emailRateLimitAllowed = true
let globalRateLimitAllowed = true
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn((key: string) => {
    let allowed = rateLimitAllowed
    if (key.startsWith('task6-leads:email:')) allowed = emailRateLimitAllowed
    else if (key === 'task6-leads:global') allowed = globalRateLimitAllowed
    return { allowed, remaining: 0, resetAt: 0 }
  }),
  getClientIp: vi.fn(() => '203.0.113.1'),
}))

const { POST } = await import('@/app/api/task6/leads/route')
const { LEAD_MAGNETS } = await import('@/lib/task6/leadMagnets')

const VALID_KEY = Object.keys(LEAD_MAGNETS)[0]

function callPost(body: Record<string, unknown>) {
  const request = new NextRequest(new URL('/api/task6/leads', 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(request)
}

const validBody = {
  email: 'reader@example.com',
  templateKey: VALID_KEY,
  newsletterOptIn: true,
  sourcePath: '/task6/task-kanri-excel',
}

describe('POST /api/task6/leads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rateLimitAllowed = true
    emailRateLimitAllowed = true
    globalRateLimitAllowed = true
  })

  it('保存して署名URL入りメールを本人へ送り200(emailSent:true)', async () => {
    const response = await callPost(validBody)

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json).toEqual({ ok: true, emailSent: true })

    expect(insertMock).toHaveBeenCalledTimes(1)
    const row = (insertMock.mock.calls[0] as unknown[])[0] as Record<string, unknown>
    expect(row.email).toBe('reader@example.com')
    expect(row.template_key).toBe(VALID_KEY)
    expect(row.newsletter_opt_in).toBe(true)
    expect(row.source_path).toBe('/task6/task-kanri-excel')

    expect(createSignedUrlMock).toHaveBeenCalledTimes(1)
    const emailArgs = (sendTemplateDownloadEmailMock.mock.calls[0] as unknown[])[0] as Record<
      string,
      unknown
    >
    expect(emailArgs.to).toBe('reader@example.com')
    expect(emailArgs.downloadUrl).toBe('https://storage.example/signed-url')
  })

  it('emailは小文字化して保存する', async () => {
    const response = await callPost({ ...validBody, email: 'Reader@Example.COM' })
    expect(response.status).toBe(200)
    const row = (insertMock.mock.calls[0] as unknown[])[0] as Record<string, unknown>
    expect(row.email).toBe('reader@example.com')
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

  it('カタログに無いtemplateKeyは400', async () => {
    const response = await callPost({ ...validBody, templateKey: 'no-such-template' })
    expect(response.status).toBe(400)
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('newsletterOptInを送らなければfalseで保存', async () => {
    const response = await callPost({ email: 'a@example.com', templateKey: VALID_KEY })
    expect(response.status).toBe(200)
    const row = (insertMock.mock.calls[0] as unknown[])[0] as Record<string, unknown>
    expect(row.newsletter_opt_in).toBe(false)
  })

  it('sourcePathが/始まりでない・長すぎる場合は捨てて保存は成功', async () => {
    const response = await callPost({ ...validBody, sourcePath: 'https://evil.example/x' })
    expect(response.status).toBe(200)
    const row = (insertMock.mock.calls[0] as unknown[])[0] as Record<string, unknown>
    expect(row.source_path).toBeNull()
  })

  it('honeypotが埋まっていたら保存せず200(成功を装う)', async () => {
    const response = await callPost({ ...validBody, website: 'http://spam.example' })
    expect(response.status).toBe(200)
    expect(insertMock).not.toHaveBeenCalled()
    expect(sendTemplateDownloadEmailMock).not.toHaveBeenCalled()
  })

  it('rate limit超過は429で保存しない', async () => {
    rateLimitAllowed = false
    const response = await callPost(validBody)
    expect(response.status).toBe(429)
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('同一宛先の1日上限を超えたら429で保存もメールもしない(送信リレー悪用対策)', async () => {
    emailRateLimitAllowed = false
    const response = await callPost(validBody)
    expect(response.status).toBe(429)
    expect(insertMock).not.toHaveBeenCalled()
    expect(sendTemplateDownloadEmailMock).not.toHaveBeenCalled()
  })

  it('全体の1日送信上限を超えたら429で保存もメールもしない', async () => {
    globalRateLimitAllowed = false
    const response = await callPost(validBody)
    expect(response.status).toBe(429)
    expect(insertMock).not.toHaveBeenCalled()
    expect(sendTemplateDownloadEmailMock).not.toHaveBeenCalled()
  })

  it('重複登録(23505)はエラーにせずlast_requested_atを更新して再送する', async () => {
    insertMock.mockResolvedValueOnce({ error: { message: 'duplicate', code: '23505' } })
    const response = await callPost(validBody)

    expect(response.status).toBe(200)
    expect(updateMock).toHaveBeenCalledTimes(1)
    expect(sendTemplateDownloadEmailMock).toHaveBeenCalledTimes(1)
  })

  it('insertがその他のエラーなら500でメールは送らない', async () => {
    insertMock.mockResolvedValueOnce({ error: { message: 'db down', code: '57P01' } })
    const response = await callPost(validBody)
    expect(response.status).toBe(500)
    expect(sendTemplateDownloadEmailMock).not.toHaveBeenCalled()
  })

  it('署名URLの発行に失敗したら500(リードは保存済み)', async () => {
    createSignedUrlMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'object not found' },
    })
    const response = await callPost(validBody)
    expect(response.status).toBe(500)
    expect(insertMock).toHaveBeenCalledTimes(1)
    expect(sendTemplateDownloadEmailMock).not.toHaveBeenCalled()
  })

  it('本人宛メールが失敗したらdownloadUrlをフォールバックで返す(200)', async () => {
    sendTemplateDownloadEmailMock.mockRejectedValueOnce(new Error('resend down'))
    const response = await callPost(validBody)

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.ok).toBe(true)
    expect(json.emailSent).toBe(false)
    expect(json.downloadUrl).toBe('https://storage.example/signed-url')
  })

  it('運営者通知メールが失敗しても200のまま', async () => {
    sendLeadNotificationEmailMock.mockRejectedValueOnce(new Error('resend down'))
    const response = await callPost(validBody)
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.emailSent).toBe(true)
  })
})
