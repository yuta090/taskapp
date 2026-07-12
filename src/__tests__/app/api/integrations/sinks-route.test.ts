import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * GET/POST /api/integrations/sinks
 * - GET: 内部メンバーなら閲覧可
 * - POST: owner/adminのみ。provider='webhook'|'notion'|'google_sheets'を許可。
 *   webhookはSSRF検証をURL登録時にも通す。google_sheetsはnotionと同様、
 *   org接続がなければ400・config(spreadsheet_id/sheet_name)を検証する(PR-4)。
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
  createNotionSink: vi.fn(),
  createGoogleSheetsSink: vi.fn(),
  findActiveNotionConnection: vi.fn(),
  findActiveGoogleSheetsConnection: vi.fn(),
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
    sinksStoreMock.findActiveNotionConnection.mockResolvedValue(null)
    sinksStoreMock.findActiveGoogleSheetsConnection.mockResolvedValue(null)
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

  it('includes notionConnection: connected=false when the org has no active Notion connection', async () => {
    const response = await callGet(ORG_ID)
    const data = await response.json()
    expect(data.notionConnection).toEqual({ connected: false, workspaceName: null })
  })

  it('includes notionConnection: connected=true with the workspace name when active', async () => {
    sinksStoreMock.findActiveNotionConnection.mockResolvedValue({
      id: 'conn-1',
      accessToken: 'secret_abc',
      workspaceName: 'Acme Workspace',
    })
    const response = await callGet(ORG_ID)
    const data = await response.json()
    expect(data.notionConnection).toEqual({ connected: true, workspaceName: 'Acme Workspace' })
  })

  it('includes googleSheetsConnection: connected=false when the org has no active connection', async () => {
    const response = await callGet(ORG_ID)
    const data = await response.json()
    expect(data.googleSheetsConnection).toEqual({ connected: false })
  })

  it('includes googleSheetsConnection: connected=true when active (no token/secret leaked)', async () => {
    sinksStoreMock.findActiveGoogleSheetsConnection.mockResolvedValue({
      id: 'conn-gs-1',
      accessToken: 'access-abc',
    })
    const response = await callGet(ORG_ID)
    const data = await response.json()
    expect(data.googleSheetsConnection).toEqual({ connected: true })
    expect(JSON.stringify(data)).not.toContain('access-abc')
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
    sinksStoreMock.createNotionSink.mockResolvedValue({ id: 'sink-2', orgId: ORG_ID, provider: 'notion' })
    sinksStoreMock.findActiveNotionConnection.mockResolvedValue({
      id: 'conn-1',
      accessToken: 'secret_abc',
      workspaceName: 'Acme Workspace',
    })
    sinksStoreMock.createGoogleSheetsSink.mockResolvedValue({ id: 'sink-3', orgId: ORG_ID, provider: 'google_sheets' })
    sinksStoreMock.findActiveGoogleSheetsConnection.mockResolvedValue({
      id: 'conn-gs-1',
      accessToken: 'access-abc',
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

  it('400 for an unknown provider string', async () => {
    const response = await callPost({ ...validBody, provider: 'carrier-pigeon' })
    expect(response.status).toBe(400)
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

  describe('provider=notion', () => {
    const notionBody = {
      orgId: ORG_ID,
      provider: 'notion',
      displayName: 'Notion連携',
      config: { database_id: '12345678-1234-1234-1234-123456789012' },
    }

    it('400 when config.database_id is missing', async () => {
      const response = await callPost({ ...notionBody, config: {} })
      expect(response.status).toBe(400)
      expect(sinksStoreMock.createNotionSink).not.toHaveBeenCalled()
    })

    it('400 when config.database_id has an invalid format (URL-path injection guard)', async () => {
      const response = await callPost({ ...notionBody, config: { database_id: '../../etc/passwd' } })
      expect(response.status).toBe(400)
      expect(sinksStoreMock.createNotionSink).not.toHaveBeenCalled()
    })

    it('400 notion_not_connected when the org has no active Notion connection', async () => {
      sinksStoreMock.findActiveNotionConnection.mockResolvedValue(null)
      const response = await callPost(notionBody)
      const data = await response.json()
      expect(response.status).toBe(400)
      expect(data.error).toBe('notion_not_connected')
      expect(sinksStoreMock.createNotionSink).not.toHaveBeenCalled()
    })

    it('201 creates the sink without a secret in the response', async () => {
      const response = await callPost(notionBody)
      const data = await response.json()
      expect(response.status).toBe(201)
      expect(data.secret).toBeUndefined()
      expect(sinksStoreMock.createNotionSink).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: ORG_ID,
          groupId: null,
          displayName: 'Notion連携',
          databaseId: '12345678-1234-1234-1234-123456789012',
          connectionId: 'conn-1',
          createdBy: 'user-1',
        }),
      )
    })
  })

  describe('provider=google_sheets', () => {
    const sheetsBody = {
      orgId: ORG_ID,
      provider: 'google_sheets',
      displayName: 'Sheets連携',
      config: { spreadsheet_id: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms', sheet_name: 'タスク' },
    }

    it('400 when config.spreadsheet_id is missing', async () => {
      const response = await callPost({ ...sheetsBody, config: { sheet_name: 'タスク' } })
      expect(response.status).toBe(400)
      expect(sinksStoreMock.createGoogleSheetsSink).not.toHaveBeenCalled()
    })

    it('400 when config.spreadsheet_id has an invalid format (URL-path injection guard)', async () => {
      const response = await callPost({
        ...sheetsBody,
        config: { spreadsheet_id: '../../etc/passwd', sheet_name: 'タスク' },
      })
      expect(response.status).toBe(400)
      expect(sinksStoreMock.createGoogleSheetsSink).not.toHaveBeenCalled()
    })

    it('400 when config.sheet_name is missing', async () => {
      const response = await callPost({
        ...sheetsBody,
        config: { spreadsheet_id: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms' },
      })
      expect(response.status).toBe(400)
      expect(sinksStoreMock.createGoogleSheetsSink).not.toHaveBeenCalled()
    })

    it('400 when config.sheet_name contains a control character', async () => {
      const response = await callPost({
        ...sheetsBody,
        config: { spreadsheet_id: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms', sheet_name: 'a\nb' },
      })
      expect(response.status).toBe(400)
      expect(sinksStoreMock.createGoogleSheetsSink).not.toHaveBeenCalled()
    })

    it('400 google_sheets_not_connected when the org has no active connection', async () => {
      sinksStoreMock.findActiveGoogleSheetsConnection.mockResolvedValue(null)
      const response = await callPost(sheetsBody)
      const data = await response.json()
      expect(response.status).toBe(400)
      expect(data.error).toBe('google_sheets_not_connected')
      expect(sinksStoreMock.createGoogleSheetsSink).not.toHaveBeenCalled()
    })

    it('201 creates the sink without a secret in the response', async () => {
      const response = await callPost(sheetsBody)
      const data = await response.json()
      expect(response.status).toBe(201)
      expect(data.secret).toBeUndefined()
      expect(sinksStoreMock.createGoogleSheetsSink).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: ORG_ID,
          groupId: null,
          displayName: 'Sheets連携',
          spreadsheetId: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
          sheetName: 'タスク',
          connectionId: 'conn-gs-1',
          createdBy: 'user-1',
        }),
      )
    })
  })
})
