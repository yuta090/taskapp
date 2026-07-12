import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * PATCH/DELETE /api/integrations/sinks/[id]
 * - org解決はsinkIdのDB上の実所属から行う(クライアント申告のorgIdは信用しない)
 * - status='active'への遷移はreactivateSink、'disabled'はdisableSinkを呼ぶ
 * - DELETEは物理削除ではなくdisableSink(status='disabled')として実装（受け入れ基準11）
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

const validateWebhookUrlMock = vi.fn()
vi.mock('@/lib/sinks/ssrf', () => ({
  validateWebhookUrl: (...args: unknown[]) => validateWebhookUrlMock(...args),
}))

const sinksStoreMock = {
  findSinkOrgId: vi.fn(),
  findSinkMeta: vi.fn(),
  updateSinkMeta: vi.fn(),
  disableSink: vi.fn(),
  reactivateSink: vi.fn(),
  rotateWebhookSecret: vi.fn(),
  ALLOWED_SINK_EVENTS: ['task.created', 'task.done', 'task.dismissed', 'task.reopened'],
}
vi.mock('@/lib/sinks/store', () => sinksStoreMock)

const { PATCH, DELETE } = await import('@/app/api/integrations/sinks/[id]/route')

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const SINK_ID = '22222222-2222-4222-8222-222222222222'

function callPatch(body: Record<string, unknown>, id = SINK_ID) {
  const request = new NextRequest(`http://localhost:3000/api/integrations/sinks/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return PATCH(request, { params: Promise.resolve({ id }) })
}

function callDelete(id = SINK_ID) {
  const request = new NextRequest(`http://localhost:3000/api/integrations/sinks/${id}`, { method: 'DELETE' })
  return DELETE(request, { params: Promise.resolve({ id }) })
}

const SINK_META = { id: SINK_ID, orgId: ORG_ID, displayName: 'x', status: 'active' }

describe('PATCH /api/integrations/sinks/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    membershipSingleMock.mockResolvedValue({ data: { role: 'owner' }, error: null })
    sinksStoreMock.findSinkOrgId.mockResolvedValue(ORG_ID)
    sinksStoreMock.updateSinkMeta.mockResolvedValue(SINK_META)
    sinksStoreMock.findSinkMeta.mockResolvedValue(SINK_META)
    sinksStoreMock.reactivateSink.mockResolvedValue(SINK_META)
    sinksStoreMock.disableSink.mockResolvedValue({ ...SINK_META, status: 'disabled' })
    sinksStoreMock.rotateWebhookSecret.mockResolvedValue({ sink: SINK_META, secret: 'whsec_new' })
    validateWebhookUrlMock.mockResolvedValue({ ok: true })
  })

  it('404 when the sink does not belong to any org', async () => {
    sinksStoreMock.findSinkOrgId.mockResolvedValue(null)
    const response = await callPatch({ displayName: 'x' })
    expect(response.status).toBe(404)
  })

  it('403 for members (owner/admin only)', async () => {
    membershipSingleMock.mockResolvedValue({ data: { role: 'member' }, error: null })
    const response = await callPatch({ displayName: 'x' })
    expect(response.status).toBe(403)
  })

  it('400 for an invalid webhook url', async () => {
    validateWebhookUrlMock.mockResolvedValue({ ok: false, reason: 'ip_denied' })
    const response = await callPatch({ config: { url: 'https://internal.example.com/hook' } })
    expect(response.status).toBe(400)
    expect(sinksStoreMock.updateSinkMeta).not.toHaveBeenCalled()
  })

  // M1回帰テスト: config を送ったのに url を欠く(または空の) config が無言で永続化され、
  // 以後の配送が全部 ssrf_blocked:invalid_url → dead になるバグを防ぐ。
  it('400 when config is provided without a url (config={})', async () => {
    const response = await callPatch({ config: {} })
    expect(response.status).toBe(400)
    expect(sinksStoreMock.updateSinkMeta).not.toHaveBeenCalled()
    expect(validateWebhookUrlMock).not.toHaveBeenCalled()
  })

  it('400 when config.url is an empty string', async () => {
    const response = await callPatch({ config: { url: '' } })
    expect(response.status).toBe(400)
    expect(sinksStoreMock.updateSinkMeta).not.toHaveBeenCalled()
  })

  it('400 when config.url is not a string (e.g. null)', async () => {
    const response = await callPatch({ config: { url: null } })
    expect(response.status).toBe(400)
    expect(sinksStoreMock.updateSinkMeta).not.toHaveBeenCalled()
  })

  it('400 for events outside the allowed set', async () => {
    const response = await callPatch({ events: ['not.a.real.event'] })
    expect(response.status).toBe(400)
  })

  it("status='active' calls reactivateSink (resets counters/schedule)", async () => {
    const response = await callPatch({ status: 'active' })
    expect(response.status).toBe(200)
    expect(sinksStoreMock.reactivateSink).toHaveBeenCalledWith(SINK_ID)
    expect(sinksStoreMock.disableSink).not.toHaveBeenCalled()
  })

  it("status='disabled' calls disableSink", async () => {
    const response = await callPatch({ status: 'disabled' })
    expect(response.status).toBe(200)
    expect(sinksStoreMock.disableSink).toHaveBeenCalledWith(SINK_ID)
  })

  it('rotateSecret returns the new secret once', async () => {
    const response = await callPatch({ rotateSecret: true })
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.secret).toBe('whsec_new')
  })

  it('plain field update does not include a secret in the response', async () => {
    const response = await callPatch({ displayName: 'renamed' })
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.secret).toBeUndefined()
    expect(sinksStoreMock.updateSinkMeta).toHaveBeenCalledWith(SINK_ID, { displayName: 'renamed' })
  })
})

describe('PATCH /api/integrations/sinks/[id] (provider=notion)', () => {
  const NOTION_SINK_META = { id: SINK_ID, orgId: ORG_ID, displayName: 'Notion連携', status: 'active', provider: 'notion' }

  beforeEach(() => {
    vi.clearAllMocks()
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    membershipSingleMock.mockResolvedValue({ data: { role: 'owner' }, error: null })
    sinksStoreMock.findSinkOrgId.mockResolvedValue(ORG_ID)
    sinksStoreMock.findSinkMeta.mockResolvedValue(NOTION_SINK_META)
    sinksStoreMock.updateSinkMeta.mockResolvedValue(NOTION_SINK_META)
    sinksStoreMock.reactivateSink.mockResolvedValue(NOTION_SINK_META)
    sinksStoreMock.disableSink.mockResolvedValue({ ...NOTION_SINK_META, status: 'disabled' })
  })

  it('400 when config.database_id is missing for a notion sink (does not attempt webhook URL validation)', async () => {
    const response = await callPatch({ config: { url: 'https://example.com/hook' } })
    expect(response.status).toBe(400)
    expect(validateWebhookUrlMock).not.toHaveBeenCalled()
    expect(sinksStoreMock.updateSinkMeta).not.toHaveBeenCalled()
  })

  it('400 when config.database_id is invalid', async () => {
    const response = await callPatch({ config: { database_id: 'not-an-id' } })
    expect(response.status).toBe(400)
    expect(sinksStoreMock.updateSinkMeta).not.toHaveBeenCalled()
  })

  it('accepts a valid database_id and updates config', async () => {
    const response = await callPatch({ config: { database_id: '12345678-1234-1234-1234-123456789012' } })
    expect(response.status).toBe(200)
    expect(sinksStoreMock.updateSinkMeta).toHaveBeenCalledWith(
      SINK_ID,
      expect.objectContaining({ config: { database_id: '12345678-1234-1234-1234-123456789012' } }),
    )
  })

  it('ignores rotateSecret for a notion sink (no secret to rotate)', async () => {
    const response = await callPatch({ rotateSecret: true })
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.secret).toBeUndefined()
    expect(sinksStoreMock.rotateWebhookSecret).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/integrations/sinks/[id] (provider=google_sheets)', () => {
  const SHEETS_SINK_META = {
    id: SINK_ID,
    orgId: ORG_ID,
    displayName: 'Sheets連携',
    status: 'active',
    provider: 'google_sheets',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    membershipSingleMock.mockResolvedValue({ data: { role: 'owner' }, error: null })
    sinksStoreMock.findSinkOrgId.mockResolvedValue(ORG_ID)
    sinksStoreMock.findSinkMeta.mockResolvedValue(SHEETS_SINK_META)
    sinksStoreMock.updateSinkMeta.mockResolvedValue(SHEETS_SINK_META)
    sinksStoreMock.reactivateSink.mockResolvedValue(SHEETS_SINK_META)
    sinksStoreMock.disableSink.mockResolvedValue({ ...SHEETS_SINK_META, status: 'disabled' })
  })

  it('400 when config.spreadsheet_id is missing (does not attempt webhook URL validation)', async () => {
    const response = await callPatch({ config: { sheet_name: 'タスク' } })
    expect(response.status).toBe(400)
    expect(validateWebhookUrlMock).not.toHaveBeenCalled()
    expect(sinksStoreMock.updateSinkMeta).not.toHaveBeenCalled()
  })

  it('400 when config.spreadsheet_id is invalid', async () => {
    const response = await callPatch({ config: { spreadsheet_id: 'bad', sheet_name: 'タスク' } })
    expect(response.status).toBe(400)
    expect(sinksStoreMock.updateSinkMeta).not.toHaveBeenCalled()
  })

  it('400 when config.sheet_name is missing', async () => {
    const response = await callPatch({
      config: { spreadsheet_id: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms' },
    })
    expect(response.status).toBe(400)
    expect(sinksStoreMock.updateSinkMeta).not.toHaveBeenCalled()
  })

  it('400 when config.sheet_name is invalid (control character)', async () => {
    const response = await callPatch({
      config: { spreadsheet_id: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms', sheet_name: 'a\nb' },
    })
    expect(response.status).toBe(400)
    expect(sinksStoreMock.updateSinkMeta).not.toHaveBeenCalled()
  })

  it('accepts a valid spreadsheet_id/sheet_name and updates config', async () => {
    const response = await callPatch({
      config: { spreadsheet_id: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms', sheet_name: '新しいシート' },
    })
    expect(response.status).toBe(200)
    expect(sinksStoreMock.updateSinkMeta).toHaveBeenCalledWith(
      SINK_ID,
      expect.objectContaining({
        config: { spreadsheet_id: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms', sheet_name: '新しいシート' },
      }),
    )
  })

  it('ignores rotateSecret for a google_sheets sink (no secret to rotate)', async () => {
    const response = await callPatch({ rotateSecret: true })
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.secret).toBeUndefined()
    expect(sinksStoreMock.rotateWebhookSecret).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/integrations/sinks/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    membershipSingleMock.mockResolvedValue({ data: { role: 'owner' }, error: null })
    sinksStoreMock.findSinkOrgId.mockResolvedValue(ORG_ID)
    sinksStoreMock.disableSink.mockResolvedValue({ ...SINK_META, status: 'disabled' })
  })

  it('403 for members (owner/admin only)', async () => {
    membershipSingleMock.mockResolvedValue({ data: { role: 'member' }, error: null })
    const response = await callDelete()
    expect(response.status).toBe(403)
  })

  it('disables the sink instead of physically deleting it', async () => {
    const response = await callDelete()
    expect(response.status).toBe(200)
    expect(sinksStoreMock.disableSink).toHaveBeenCalledWith(SINK_ID)
  })

  it('404 when the sink is not found', async () => {
    sinksStoreMock.disableSink.mockResolvedValue(null)
    const response = await callDelete()
    expect(response.status).toBe(404)
  })
})
