import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * PATCH /api/integrations/connections/[id]/import-config
 *
 * - owner/adminのみ(接続のorg_idから解決)
 * - import_config( { target_space_id, read_list_ids?, default_assignee_id? } )を更新
 * - org境界検証はDBトリガー(integration_connections_validate_import_config)が担う。
 *   トリガー例外(admin clientのupdateがerrorを返すケース)は422+ユーザー向けメッセージに変換する。
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

const findResultMock = vi.fn()
const updateResultMock = vi.fn()
let updatePayload: Record<string, unknown> | null = null

function makeSelectChain() {
  const chain: Record<string, unknown> = {}
  Object.assign(chain, {
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(() => Promise.resolve(findResultMock())),
  })
  return chain
}

function makeUpdateChain() {
  const chain: Record<string, unknown> = {}
  Object.assign(chain, {
    eq: vi.fn(() => chain),
    select: vi.fn(() => ({
      maybeSingle: vi.fn(() => Promise.resolve(updateResultMock())),
    })),
  })
  return chain
}

const createAdminClientMock = vi.fn(() => ({
  from: vi.fn(() => ({
    select: vi.fn(() => makeSelectChain()),
    update: vi.fn((payload: Record<string, unknown>) => {
      updatePayload = payload
      return makeUpdateChain()
    }),
  })),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => createAdminClientMock(),
}))

const { PATCH } = await import('@/app/api/integrations/connections/[id]/import-config/route')

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const CONNECTION_ID = '22222222-2222-4222-8222-222222222222'
const SPACE_ID = '33333333-3333-4333-8333-333333333333'

function callPatch(id: string, body: Record<string, unknown>) {
  const request = new NextRequest(`http://localhost:3000/api/integrations/connections/${id}/import-config`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return PATCH(request, { params: Promise.resolve({ id }) })
}

const validBody = { import_config: { target_space_id: SPACE_ID } }

beforeEach(() => {
  vi.clearAllMocks()
  updatePayload = null
  getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
  membershipSingleMock.mockResolvedValue({ data: { role: 'owner' }, error: null })
  findResultMock.mockReturnValue({ data: { org_id: ORG_ID }, error: null })
  updateResultMock.mockReturnValue({
    data: { id: CONNECTION_ID, import_config: validBody.import_config },
    error: null,
  })
})

describe('PATCH /api/integrations/connections/[id]/import-config', () => {
  it('400 for an invalid connection id', async () => {
    const response = await callPatch('not-a-uuid', validBody)
    expect(response.status).toBe(400)
  })

  it('404 when the connection does not belong to any org', async () => {
    findResultMock.mockReturnValue({ data: null, error: null })
    const response = await callPatch(CONNECTION_ID, validBody)
    expect(response.status).toBe(404)
  })

  it('403 for members (owner/admin only)', async () => {
    membershipSingleMock.mockResolvedValue({ data: { role: 'member' }, error: null })
    const response = await callPatch(CONNECTION_ID, validBody)
    expect(response.status).toBe(403)
  })

  it('400 when import_config is missing or not an object', async () => {
    const response = await callPatch(CONNECTION_ID, { import_config: 'nope' })
    expect(response.status).toBe(400)
  })

  it('200 updates import_config', async () => {
    const response = await callPatch(CONNECTION_ID, validBody)
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.import_config).toEqual(validBody.import_config)
    expect(updatePayload).toEqual({ import_config: validBody.import_config })
  })

  it('422 when the DB trigger (P0001) rejects an out-of-org target_space_id (user-facing message)', async () => {
    updateResultMock.mockReturnValue({
      data: null,
      error: {
        code: 'P0001',
        message: 'import_config.target_space_id must reference a space in the connection\'s org',
      },
    })
    const response = await callPatch(CONNECTION_ID, validBody)
    const data = await response.json()
    expect(response.status).toBe(422)
    expect(typeof data.error).toBe('string')
    expect(data.error.length).toBeGreaterThan(0)
  })

  it('400 when a UUID cast fails (22P02) for target_space_id/default_assignee_id', async () => {
    updateResultMock.mockReturnValue({
      data: null,
      error: { code: '22P02', message: 'invalid input syntax for type uuid: "not-a-uuid"' },
    })
    const response = await callPatch(CONNECTION_ID, validBody)
    expect(response.status).toBe(400)
  })

  it('500 (not 422) for a transient/unknown DB error — never mislabeled as a permanent input error', async () => {
    updateResultMock.mockReturnValue({
      data: null,
      error: { code: '08006', message: 'connection failure' },
    })
    const response = await callPatch(CONNECTION_ID, validBody)
    const data = await response.json()
    expect(response.status).toBe(500)
    // 内部エラー文言は返さない
    expect(data.error).not.toContain('connection failure')
  })
})
