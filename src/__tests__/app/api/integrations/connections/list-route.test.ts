import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * GET /api/integrations/connections?orgId= — 双方向同期接続(multica/google_tasks)一覧。
 * - internal member 可(閲覧)。編集は各変異APIが owner/admin を担保。
 * - **secret(*_secret_encrypted)を返さない**(metadata から base_url だけ露出)。
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

let listRows: unknown[] = []
let listError: unknown = null
const createAdminClientMock = vi.fn(() => ({
  from: vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        in: vi.fn(() => ({
          order: vi.fn(() => Promise.resolve({ data: listRows, error: listError })),
        })),
      })),
    })),
  })),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => createAdminClientMock(),
}))

const { GET } = await import('@/app/api/integrations/connections/route')

const ORG_ID = '11111111-1111-4111-8111-111111111111'

function callGet(orgId: string = ORG_ID) {
  const request = new NextRequest(
    `http://localhost:3000/api/integrations/connections?orgId=${orgId}`,
  )
  return GET(request)
}

beforeEach(() => {
  vi.clearAllMocks()
  listRows = []
  listError = null
  getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
  membershipSingleMock.mockResolvedValue({ data: { role: 'member' }, error: null })
})

describe('GET /api/integrations/connections', () => {
  it('400 when orgId is invalid', async () => {
    const res = await callGet('not-a-uuid')
    expect(res.status).toBe(400)
  })

  it('403 when caller is not an internal member', async () => {
    membershipSingleMock.mockResolvedValue({ data: null, error: { message: 'no rows' } })
    const res = await callGet()
    expect(res.status).toBe(403)
  })

  it('members can view; returns viewerRole and connection summaries', async () => {
    listRows = [
      {
        id: 'c1',
        provider: 'multica',
        status: 'active',
        import_enabled: false,
        import_config: {},
        metadata: {
          multica: {
            base_url: 'https://multica.example.com',
            send_secret_encrypted: 'enc-send',
            receive_secret_encrypted: 'enc-recv',
          },
        },
        created_at: '2026-07-20T00:00:00Z',
      },
      {
        id: 'c2',
        provider: 'google_tasks',
        status: 'active',
        import_enabled: true,
        import_config: { target_space_id: 's1' },
        metadata: {},
        created_at: '2026-07-20T01:00:00Z',
      },
    ]
    const res = await callGet()
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.viewerRole).toBe('member')
    expect(json.connections).toHaveLength(2)
    expect(json.connections[0]).toEqual({
      id: 'c1',
      provider: 'multica',
      status: 'active',
      baseUrl: 'https://multica.example.com',
      importEnabled: false,
      importConfig: {},
      createdAt: '2026-07-20T00:00:00Z',
    })
    expect(json.connections[1].importConfig).toEqual({ target_space_id: 's1' })
    expect(json.connections[1].importEnabled).toBe(true)
  })

  it('never leaks secrets: serialized response contains no *_secret_encrypted', async () => {
    listRows = [
      {
        id: 'c1',
        provider: 'multica',
        status: 'active',
        import_enabled: false,
        import_config: {},
        metadata: {
          multica: {
            base_url: 'https://multica.example.com',
            send_secret_encrypted: 'SUPER-SECRET-SEND',
            receive_secret_encrypted: 'SUPER-SECRET-RECV',
          },
        },
        created_at: '2026-07-20T00:00:00Z',
      },
    ]
    const res = await callGet()
    const text = JSON.stringify(await res.json())
    expect(text).not.toContain('SUPER-SECRET-SEND')
    expect(text).not.toContain('SUPER-SECRET-RECV')
    expect(text).not.toContain('secret_encrypted')
  })

  it('500 when the list query errors', async () => {
    listError = { message: 'db down' }
    const res = await callGet()
    expect(res.status).toBe(500)
  })
})
