import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { createHash } from 'node:crypto'

/**
 * /api/keys — org/space-scoped API key management.
 *
 * Security-critical: creation/listing/deletion of API keys must be gated by
 * org membership AND, for POST, space membership. DELETE must reject a key
 * whose org_id doesn't match the caller-supplied orgId (cross-org deletion).
 */

const ORG_ID = 'org-1'
const OTHER_ORG_ID = 'org-2'
const SPACE_ID = 'space-1'

const mockUser = { id: 'user-1' }

let authResponse: { data: { user: typeof mockUser | null } }
let orgMembershipResponse: { data: { role: string } | null }
let spaceMembershipResponse: { data: { id: string; role?: string } | null }

let adminInsertResponse: { data: Record<string, unknown> | null; error: { message: string } | null }
let adminSelectSingleResponse: {
  data: { org_id: string; space_id?: string; scope?: string; created_by?: string; user_id?: string | null } | null
}
let adminDeleteResponse: { error: { message: string } | null }
let adminListResponse: { data: Record<string, unknown>[] | null; error: { message: string } | null }

const rateLimitAllowedMock = vi.fn((..._args: unknown[]) => ({
  allowed: true,
  remaining: 19,
  resetAt: Date.now() + 1000,
}))

const insertMock = vi.fn((_payload: Record<string, unknown>) => ({
  select: vi.fn(() => ({
    single: vi.fn(() => Promise.resolve(adminInsertResponse)),
  })),
}))

const deleteEqOrgMock = vi.fn(() => Promise.resolve(adminDeleteResponse))
const deleteEqIdMock = vi.fn(() => ({ eq: deleteEqOrgMock }))
const deleteMock = vi.fn(() => ({ eq: deleteEqIdMock }))

/** GET（一覧）で api_keys に掛けた絞り込み（列, 値） */
let listEqCalls: Array<[string, unknown]> = []
/** プロジェクトごとの役割（無ければ spaceMembershipResponse を使う） */
let spaceMembershipsBySpace: Record<string, { data: { id: string; role?: string } | null }> = {}
/** 役割を問い合わせたプロジェクト（順番どおり） */
let spaceRoleLookups: string[] = []
/** そのプロジェクトがどの組織のものか */
let spaceOrgResponse: { data: { org_id: string } | null }

const selectQueryMock = vi.fn((columns: string) => {
  // GET (list): .select(...).eq(org_id).eq(space_id).eq(scope).order(...)
  if (columns.includes('name')) {
    const chain = {
      eq: vi.fn((column: string, value: unknown) => {
        listEqCalls.push([column, value])
        return chain
      }),
      order: vi.fn(() => Promise.resolve(adminListResponse)),
    }
    return chain
  }
  // DELETE existing-key lookup: .select('org_id').eq(id).single()
  return {
    eq: vi.fn(() => ({
      single: vi.fn(() => Promise.resolve(adminSelectSingleResponse)),
    })),
  }
})

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (...args: unknown[]) => rateLimitAllowedMock(...args),
  getClientIp: () => '127.0.0.1',
}))

// Session-scoped client: auth + org/space membership checks.
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: { getSession: () => Promise.resolve({ data: { session: null } }), mfa: { listFactors: () => Promise.resolve({ data: { all: [] }, error: null }) }, 
        getUser: vi.fn(() => Promise.resolve(authResponse)),
      },
      from: vi.fn((table: string) => {
        if (table === 'org_memberships') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn(() => Promise.resolve(orgMembershipResponse)),
                })),
              })),
            })),
          }
        }
        if (table === 'space_memberships') {
          // .select(...).eq('user_id', …).eq('space_id', <space>).single() — プロジェクトごとに役割を変えられる
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn((_column: string, spaceId: string) => ({
                  single: vi.fn(() => {
                    spaceRoleLookups.push(spaceId)
                    return Promise.resolve(spaceMembershipsBySpace[spaceId] ?? spaceMembershipResponse)
                  }),
                })),
              })),
            })),
          }
        }
        return {}
      }),
    })
  ),
}))

// Admin (service-role) client: bypasses RLS for api_keys table access.
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'api_keys') {
        return {
          insert: insertMock,
          select: selectQueryMock,
          delete: deleteMock,
        }
      }
      if (table === 'spaces') {
        // そのプロジェクトがどの組織のものか: .select('org_id').eq('id', spaceId).single()
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({ single: vi.fn(() => Promise.resolve(spaceOrgResponse)) })),
          })),
        }
      }
      return {}
    }),
  })),
}))

const { POST, DELETE, GET } = await import('@/app/api/keys/route')

function callPost(body: Record<string, unknown>) {
  const request = new NextRequest(new URL('/api/keys', 'http://localhost:3000'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(request)
}

function callDelete(params: Record<string, string>) {
  const url = new URL('/api/keys', 'http://localhost:3000')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const request = new NextRequest(url, { method: 'DELETE' })
  return DELETE(request)
}

function callGet(params: Record<string, string>) {
  const url = new URL('/api/keys', 'http://localhost:3000')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const request = new NextRequest(url, { method: 'GET' })
  return GET(request)
}

const basePostBody = {
  orgId: ORG_ID,
  spaceId: SPACE_ID,
  name: 'My Key',
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-secret'

  rateLimitAllowedMock.mockReturnValue({ allowed: true, remaining: 19, resetAt: Date.now() + 1000 })
  authResponse = { data: { user: mockUser } }
  orgMembershipResponse = { data: { role: 'owner' } }
  spaceMembershipResponse = { data: { id: 'space-membership-1', role: 'admin' } }

  adminInsertResponse = {
    data: { id: 'key-1', org_id: ORG_ID, space_id: SPACE_ID, name: 'My Key' },
    error: null,
  }
  adminSelectSingleResponse = {
    data: { org_id: ORG_ID, space_id: SPACE_ID, scope: 'space', created_by: 'someone-else', user_id: 'someone-else' },
  }
  spaceOrgResponse = { data: { org_id: ORG_ID } }
  spaceMembershipsBySpace = {}
  spaceRoleLookups = []
  listEqCalls = []
  adminDeleteResponse = { error: null }
  adminListResponse = {
    data: [{ id: 'key-1', name: 'My Key', key_prefix: 'sk_live_ab' }],
    error: null,
  }
})

describe('POST /api/keys', () => {
  it('returns 429 when rate limited', async () => {
    rateLimitAllowedMock.mockReturnValue({ allowed: false, remaining: 0, resetAt: Date.now() + 5000 })

    const response = await callPost(basePostBody)

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBeTruthy()
  })

  it('returns 400 when required fields are missing', async () => {
    const response = await callPost({ orgId: ORG_ID, spaceId: SPACE_ID })

    expect(response.status).toBe(400)
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('returns 401 when there is no session', async () => {
    authResponse = { data: { user: null } }

    const response = await callPost(basePostBody)

    expect(response.status).toBe(401)
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('returns 403 when the caller is not a member of the org', async () => {
    orgMembershipResponse = { data: null }

    const response = await callPost(basePostBody)

    expect(response.status).toBe(403)
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('returns 403 when the caller has no access to the specified space', async () => {
    spaceMembershipResponse = { data: null }

    const response = await callPost(basePostBody)
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toBe('Access denied to this space')
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('creates the key and scopes created_by to the authenticated user', async () => {
    const response = await callPost(basePostBody)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.data).toEqual(adminInsertResponse.data)
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ org_id: ORG_ID, space_id: SPACE_ID, created_by: mockUser.id })
    )
  })

  // CLI から使えない鍵が作られていた不具合の回帰（2026-09-10）。
  // 鍵に「使う人」(user_id) が無いと、CLI 側の権限確認(mcp_authorize)がメンバーを特定できず
  // 「User is not a member of this space」で必ず断られていた。
  it('records the creator as the key user so the CLI can act as that member', async () => {
    await callPost(basePostBody)

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: mockUser.id, created_by: mockUser.id })
    )
  })

  it('defaults to read-only when no actions are given', async () => {
    await callPost(basePostBody)

    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ allowed_actions: ['read'] }))
  })

  it('stores the chosen actions and always includes read', async () => {
    await callPost({ ...basePostBody, allowedActions: ['write', 'bulk'] })

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ allowed_actions: ['read', 'write', 'bulk'] })
    )
  })

  it('returns 400 for an unknown action and never passes it to the DB', async () => {
    const response = await callPost({ ...basePostBody, allowedActions: ['write', 'admin'] })

    expect(response.status).toBe(400)
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('returns a generic 500 (no internal error detail) when insert fails', async () => {
    adminInsertResponse = { data: null, error: { message: 'duplicate key value violates unique constraint' } }

    const response = await callPost(basePostBody)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Failed to create API key')
    expect(data.error).not.toContain('constraint')
  })
})

// APIキーは推測できない乱数からサーバー側で作る。画面（ブラウザ）から届いたキー・ハッシュは信用しない
describe('POST /api/keys — key generation happens on the server', () => {
  it('creates the key even when the browser sends no keyHash/keyPrefix at all', async () => {
    const response = await callPost({ orgId: ORG_ID, spaceId: SPACE_ID, name: 'My Key' })

    expect(response.status).toBe(200)
    expect(insertMock).toHaveBeenCalled()
  })

  // 本番切り替え直後、開きっぱなしの古い画面（ブラウザ側でキーを作る旧版）が
  // 自分で作った keyHash/keyPrefix を送ってくることがある。黙って無視すると、
  // 画面に表示済みのキーが実際には保存されていない（＝使えない）という事故になるため、作らずに断る
  it('rejects with 400 and does not create a key when the browser sends keyHash', async () => {
    const response = await callPost({ ...basePostBody, keyHash: 'client-made-hash' })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toContain('再読み込み')
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('rejects with 400 and does not create a key when the browser sends keyPrefix', async () => {
    const response = await callPost({ ...basePostBody, keyPrefix: 'client_prefix' })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toContain('再読み込み')
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('returns a plaintext key (tsk_ + 32 alphanumerics) whose SHA-256 matches the stored hash', async () => {
    const response = await callPost(basePostBody)
    const data = await response.json()

    expect(data.key).toMatch(/^tsk_[A-Za-z0-9]{32}$/)
    const inserted = insertMock.mock.calls.at(-1)?.[0] as { key_hash: string }
    expect(inserted.key_hash).toBe(createHash('sha256').update(data.key).digest('hex'))
  })

  it('marks the response as non-cacheable, since it carries a one-time plaintext key', async () => {
    const response = await callPost(basePostBody)

    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('generates a different key on every call', async () => {
    await callPost(basePostBody)
    const first = (insertMock.mock.calls.at(-1)?.[0] as { key_hash: string }).key_hash

    await callPost(basePostBody)
    const second = (insertMock.mock.calls.at(-1)?.[0] as { key_hash: string }).key_hash

    expect(first).not.toBe(second)
  })
})

describe('DELETE /api/keys', () => {
  it('returns 429 when rate limited', async () => {
    rateLimitAllowedMock.mockReturnValue({ allowed: false, remaining: 0, resetAt: Date.now() + 5000 })

    const response = await callDelete({ id: 'key-1', orgId: ORG_ID })

    expect(response.status).toBe(429)
  })

  it('returns 400 when id or orgId is missing', async () => {
    const response = await callDelete({ id: 'key-1' })

    expect(response.status).toBe(400)
  })

  it('returns 401 when there is no session', async () => {
    authResponse = { data: { user: null } }

    const response = await callDelete({ id: 'key-1', orgId: ORG_ID })

    expect(response.status).toBe(401)
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('returns 403 when the caller is not a member of the org', async () => {
    orgMembershipResponse = { data: null }

    const response = await callDelete({ id: 'key-1', orgId: ORG_ID })

    expect(response.status).toBe(403)
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the key does not exist', async () => {
    adminSelectSingleResponse = { data: null }

    const response = await callDelete({ id: 'missing-key', orgId: ORG_ID })

    expect(response.status).toBe(404)
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('returns 403 and does not delete when the key belongs to a different org (cross-org deletion attempt)', async () => {
    adminSelectSingleResponse = { data: { org_id: OTHER_ORG_ID } }

    const response = await callDelete({ id: 'key-1', orgId: ORG_ID })
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toBe('Access denied')
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('deletes the key when it belongs to the caller org', async () => {
    const response = await callDelete({ id: 'key-1', orgId: ORG_ID })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(deleteMock).toHaveBeenCalled()
    expect(deleteEqIdMock).toHaveBeenCalledWith('id', 'key-1')
    expect(deleteEqOrgMock).toHaveBeenCalledWith('org_id', ORG_ID)
  })
})

describe('GET /api/keys', () => {
  it('returns 429 when rate limited', async () => {
    rateLimitAllowedMock.mockReturnValue({ allowed: false, remaining: 0, resetAt: Date.now() + 5000 })

    const response = await callGet({ orgId: ORG_ID, spaceId: SPACE_ID })

    expect(response.status).toBe(429)
  })

  it('returns 400 when orgId or spaceId is missing', async () => {
    const response = await callGet({ orgId: ORG_ID })

    expect(response.status).toBe(400)
  })

  it('returns 401 when there is no session', async () => {
    authResponse = { data: { user: null } }

    const response = await callGet({ orgId: ORG_ID, spaceId: SPACE_ID })

    expect(response.status).toBe(401)
  })

  it('returns 403 when the caller is not a member of the org', async () => {
    orgMembershipResponse = { data: null }

    const response = await callGet({ orgId: ORG_ID, spaceId: SPACE_ID })

    expect(response.status).toBe(403)
  })

  it('lists keys for the org/space without leaking key_hash', async () => {
    const response = await callGet({ orgId: ORG_ID, spaceId: SPACE_ID })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.data).toEqual(adminListResponse.data)
    expect(selectQueryMock).toHaveBeenCalledWith(expect.not.stringContaining('key_hash'))
  })

  // 鍵が作った人の代理として実際に動くようになったので、管理者が一覧で「何を許したか」と
  // 「CLI では動かない古い鍵（持ち主が空）か」を見分けられるようにする
  it('returns the allowed actions and the key user so the list can flag old keys', async () => {
    await callGet({ orgId: ORG_ID, spaceId: SPACE_ID })

    const columns = String(selectQueryMock.mock.calls.at(-1)?.[0] ?? '').split(',').map((c) => c.trim())
    expect(columns).toEqual(expect.arrayContaining(['allowed_actions', 'user_id']))
  })
})

// プロジェクトの APIキーを発行・一覧・削除できるのは、組織の owner とそのプロジェクトの admin だけ
// （削除は、自分が作ったキーなら誰でも）。画面の「管理者限定」と同じ条件をサーバーでも守る。
describe('project API keys are managed by org owners and project admins only', () => {
  beforeEach(() => {
    orgMembershipResponse = { data: { role: 'member' } }
  })

  it('POST: a project editor cannot issue a key', async () => {
    spaceMembershipResponse = { data: { id: 'sm-1', role: 'editor' } }

    const response = await callPost(basePostBody)

    expect(response.status).toBe(403)
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('POST: a project admin can issue a key', async () => {
    spaceMembershipResponse = { data: { id: 'sm-1', role: 'admin' } }

    const response = await callPost(basePostBody)

    expect(response.status).toBe(200)
    expect(insertMock).toHaveBeenCalled()
  })

  it('GET: a project editor cannot list the keys', async () => {
    spaceMembershipResponse = { data: { id: 'sm-1', role: 'editor' } }

    const response = await callGet({ orgId: ORG_ID, spaceId: SPACE_ID })

    expect(response.status).toBe(403)
    expect(selectQueryMock).not.toHaveBeenCalled()
  })

  it('GET: a client member cannot list the keys', async () => {
    orgMembershipResponse = { data: { role: 'client' } }
    spaceMembershipResponse = { data: { id: 'sm-1', role: 'client' } }

    const response = await callGet({ orgId: ORG_ID, spaceId: SPACE_ID })

    expect(response.status).toBe(403)
    expect(selectQueryMock).not.toHaveBeenCalled()
  })

  it('GET: a project admin can list the keys', async () => {
    spaceMembershipResponse = { data: { id: 'sm-1', role: 'admin' } }

    const response = await callGet({ orgId: ORG_ID, spaceId: SPACE_ID })

    expect(response.status).toBe(200)
  })

  it('GET: an org owner can list the keys without being a project member', async () => {
    orgMembershipResponse = { data: { role: 'owner' } }
    spaceMembershipResponse = { data: null }

    const response = await callGet({ orgId: ORG_ID, spaceId: SPACE_ID })

    expect(response.status).toBe(200)
  })

  it("DELETE: a project editor cannot delete someone else's key", async () => {
    spaceMembershipResponse = { data: { id: 'sm-1', role: 'editor' } }

    const response = await callDelete({ id: 'key-1', orgId: ORG_ID })

    expect(response.status).toBe(403)
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('DELETE: anyone in the org can delete a key they created themselves', async () => {
    spaceMembershipResponse = { data: { id: 'sm-1', role: 'editor' } }
    adminSelectSingleResponse = {
      data: { org_id: ORG_ID, space_id: SPACE_ID, created_by: mockUser.id, user_id: mockUser.id },
    }

    const response = await callDelete({ id: 'key-1', orgId: ORG_ID })

    expect(response.status).toBe(200)
    expect(deleteMock).toHaveBeenCalled()
  })

  it("DELETE: a project admin can delete another member's key in that project", async () => {
    spaceMembershipResponse = { data: { id: 'sm-1', role: 'admin' } }

    const response = await callDelete({ id: 'key-1', orgId: ORG_ID })

    expect(response.status).toBe(200)
    expect(deleteMock).toHaveBeenCalled()
  })
})

// 送られてきた組織とプロジェクトの組み合わせを確かめる。個人用の鍵（アカウントの APIキー）は
// プロジェクトの管理から外し、本人と組織の owner だけが消せる
describe('project API keys: org/project consistency and personal keys', () => {
  const OTHER_SPACE = 'space-2'

  it('POST: refuses when the project does not belong to the given org, even for that org owner', async () => {
    spaceOrgResponse = { data: { org_id: OTHER_ORG_ID } }

    const response = await callPost(basePostBody)

    expect(response.status).toBe(403)
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('GET: refuses when the project does not belong to the given org', async () => {
    spaceOrgResponse = { data: { org_id: OTHER_ORG_ID } }

    const response = await callGet({ orgId: ORG_ID, spaceId: SPACE_ID })

    expect(response.status).toBe(403)
    expect(selectQueryMock).not.toHaveBeenCalled()
  })

  it('GET: lists only project keys, not personal account keys', async () => {
    await callGet({ orgId: ORG_ID, spaceId: SPACE_ID })

    expect(listEqCalls).toContainEqual(['space_id', SPACE_ID])
    expect(listEqCalls).toContainEqual(['scope', 'space'])
  })

  it("DELETE: judges by the role in the key's own project, not another project", async () => {
    orgMembershipResponse = { data: { role: 'member' } }
    spaceMembershipsBySpace = {
      [SPACE_ID]: { data: { id: 'sm-1', role: 'editor' } },
      [OTHER_SPACE]: { data: { id: 'sm-2', role: 'admin' } },
    }

    const response = await callDelete({ id: 'key-1', orgId: ORG_ID })

    expect(response.status).toBe(403)
    expect(spaceRoleLookups).toEqual([SPACE_ID])
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('DELETE: a key without a project can only be deleted by its creator or the org owner', async () => {
    orgMembershipResponse = { data: { role: 'member' } }
    spaceMembershipResponse = { data: { id: 'sm-1', role: 'admin' } }
    adminSelectSingleResponse = {
      data: { org_id: ORG_ID, space_id: undefined, scope: 'space', created_by: 'someone-else', user_id: 'someone-else' },
    }

    const response = await callDelete({ id: 'key-1', orgId: ORG_ID })

    expect(response.status).toBe(403)
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('DELETE: the person a key acts for can delete it', async () => {
    orgMembershipResponse = { data: { role: 'member' } }
    spaceMembershipResponse = { data: { id: 'sm-1', role: 'viewer' } }
    adminSelectSingleResponse = {
      data: { org_id: ORG_ID, space_id: SPACE_ID, scope: 'user', created_by: 'someone-else', user_id: mockUser.id },
    }

    const response = await callDelete({ id: 'key-1', orgId: ORG_ID })

    expect(response.status).toBe(200)
    expect(deleteMock).toHaveBeenCalled()
  })

  it("DELETE: a project admin cannot delete someone else's personal key", async () => {
    orgMembershipResponse = { data: { role: 'member' } }
    spaceMembershipResponse = { data: { id: 'sm-1', role: 'admin' } }
    adminSelectSingleResponse = {
      data: { org_id: ORG_ID, space_id: SPACE_ID, scope: 'user', created_by: 'someone-else', user_id: 'someone-else' },
    }

    const response = await callDelete({ id: 'key-1', orgId: ORG_ID })

    expect(response.status).toBe(403)
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it("DELETE: the org owner can delete someone else's personal key", async () => {
    adminSelectSingleResponse = {
      data: { org_id: ORG_ID, space_id: SPACE_ID, scope: 'user', created_by: 'someone-else', user_id: 'someone-else' },
    }

    const response = await callDelete({ id: 'key-1', orgId: ORG_ID })

    expect(response.status).toBe(200)
    expect(deleteMock).toHaveBeenCalled()
  })
})
