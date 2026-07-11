import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * GET/POST /api/integrations/sinks
 * - GET: 内部メンバーなら閲覧可
 * - POST: owner/adminのみ。provider='webhook'のみ許可(PR-1)。SSRF検証をURL登録時にも通す
 */

const getUserMock = vi.fn()
const membershipSingleMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: getUserMock },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({ single: membershipSingleMock })),
        })),
      })),
    })),
  })),
}))

const channelsStoreMock = { verifyGroupInOrg: vi.fn() }
vi.mock('@/lib/channels/store', () => channelsStoreMock)

const validateWebhookUrlMock = vi.fn()
vi.mock('@/lib/sinks/ssrf', () => ({
  validateWebhookUrl: (...args: unknown[]) => validateWebhookUrlMock(...args),
}))

const sinksStoreMock = {
  createWebhookSink: vi.fn(),
  listSinksForOrg: vi.fn(),
  findLatestDeliveryStatusForOrg: vi.fn(),
  ALLOWED_SINK_EVENTS: ['task.created', 'task.done', 'task.dismissed', 'task.reopened'],
  DEFAULT_SINK_EVENTS: ['task.created', 'task.done', 'task.dismissed'],
}
vi.mock('@/lib/sinks/store', () => sinksStoreMock)

const { GET, POST } = await import('@/app/api/integrations/sinks/route')

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const GROUP_ID = '22222222-2222-4222-8222-222222222222'

function callGet(orgId: string) {
  const request = new NextRequest(`http://localhost:3000/api/integrations/sinks?orgId=${orgId}`)
  return GET(request)
}

function callPost(body: Record<string, unknown>) {
  const request = new NextRequest('http://localhost:3000/api/integrations/sinks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(request)
}

describe('GET /api/integrations/sinks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    membershipSingleMock.mockResolvedValue({ data: { role: 'member' }, error: null })
    sinksStoreMock.listSinksForOrg.mockResolvedValue([])
    sinksStoreMock.findLatestDeliveryStatusForOrg.mockResolvedValue(new Map())
  })

  it('401 when not logged in', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const response = await callGet(ORG_ID)
    expect(response.status).toBe(401)
  })

  it('403 for non-internal members', async () => {
    membershipSingleMock.mockResolvedValue({ data: { role: 'client' }, error: null })
    const response = await callGet(ORG_ID)
    expect(response.status).toBe(403)
  })

  it('400 for an invalid orgId', async () => {
    const response = await callGet('not-a-uuid')
    expect(response.status).toBe(400)
  })

  it('200 with sinks merged with latest delivery status', async () => {
    sinksStoreMock.listSinksForOrg.mockResolvedValue([{ id: 'sink-1', displayName: 'x' }])
    sinksStoreMock.findLatestDeliveryStatusForOrg.mockResolvedValue(
      new Map([['sink-1', { status: 'sent', eventType: 'task.created', createdAt: '2026-07-11T00:00:00.000Z' }]]),
    )
    const response = await callGet(ORG_ID)
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.sinks[0].lastDelivery.status).toBe('sent')
  })
})

describe('POST /api/integrations/sinks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    membershipSingleMock.mockResolvedValue({ data: { role: 'owner' }, error: null })
    channelsStoreMock.verifyGroupInOrg.mockResolvedValue({ id: GROUP_ID, orgId: ORG_ID })
    validateWebhookUrlMock.mockResolvedValue({ ok: true, hostname: 'example.com', port: 443, resolvedIps: ['8.8.8.8'] })
    sinksStoreMock.createWebhookSink.mockResolvedValue({
      sink: { id: 'sink-1', orgId: ORG_ID },
      secret: 'whsec_abc',
    })
  })

  const validBody = {
    orgId: ORG_ID,
    provider: 'webhook',
    displayName: 'My Webhook',
    config: { url: 'https://example.com/hook' },
  }

  it('403 for members (owner/admin only)', async () => {
    membershipSingleMock.mockResolvedValue({ data: { role: 'member' }, error: null })
    const response = await callPost(validBody)
    expect(response.status).toBe(403)
  })

  it('400 for provider other than webhook', async () => {
    const response = await callPost({ ...validBody, provider: 'notion' })
    expect(response.status).toBe(400)
    expect(sinksStoreMock.createWebhookSink).not.toHaveBeenCalled()
  })

  it('400 when displayName is missing', async () => {
    const response = await callPost({ ...validBody, displayName: '' })
    expect(response.status).toBe(400)
  })

  it('400 when config.url is missing', async () => {
    const response = await callPost({ ...validBody, config: {} })
    expect(response.status).toBe(400)
  })

  it('400 when the SSRF validator rejects the url (never reaches createWebhookSink)', async () => {
    validateWebhookUrlMock.mockResolvedValue({ ok: false, reason: 'ip_denied' })
    const response = await callPost(validBody)
    expect(response.status).toBe(400)
    expect(sinksStoreMock.createWebhookSink).not.toHaveBeenCalled()
  })

  it('404 when groupId does not belong to the org', async () => {
    channelsStoreMock.verifyGroupInOrg.mockResolvedValue(null)
    const response = await callPost({ ...validBody, groupId: GROUP_ID })
    expect(response.status).toBe(404)
  })

  it('400 for an events value outside the allowed set', async () => {
    const response = await callPost({ ...validBody, events: ['task.created', 'bogus.event'] })
    expect(response.status).toBe(400)
  })

  it('201 creates the sink and returns the secret once', async () => {
    const response = await callPost(validBody)
    const data = await response.json()
    expect(response.status).toBe(201)
    expect(data.secret).toBe('whsec_abc')
    expect(sinksStoreMock.createWebhookSink).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: ORG_ID,
        groupId: null,
        displayName: 'My Webhook',
        url: 'https://example.com/hook',
        events: ['task.created', 'task.done', 'task.dismissed'],
        createdBy: 'user-1',
      }),
    )
  })
})
