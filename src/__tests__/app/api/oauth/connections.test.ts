import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 外部チャットとの接続の一覧と解除。
 *
 * ⚠ 見える範囲・解除できる範囲が権限の境界になる:
 *   - 見えるのは「自分の接続」＋「自分がオーナーの組織の接続」だけ
 *   - 解除できるのは、その接続を作った本人か、その組織のオーナーだけ
 */

let currentUser: { id: string } | null = { id: 'user-1' }
/** その人の組織の役割。org_id -> role */
let myRoles: { org_id: string; role: string }[] = []

/** admin クライアントが受け取ったクエリの記録（見せる範囲の絞り込みを確かめる） */
const adminQueries: { table: string; filters: string[] }[] = []
let apiKeyRows: Record<string, unknown>[] = []
let revokedIds: string[] = []

function makeAdminQuery(table: string) {
  const filters: string[] = []
  const record = { table, filters }
  adminQueries.push(record)
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: (col: string, val: unknown) => {
      filters.push(`eq:${col}=${val}`)
      return chain
    },
    in: (col: string, vals: unknown[]) => {
      filters.push(`in:${col}=${(vals as string[]).join('|')}`)
      return chain
    },
    is: () => chain,
    or: (expr: string) => {
      filters.push(`or:${expr}`)
      return chain
    },
    order: () => chain,
    update: (patch: Record<string, unknown>) => {
      filters.push(`update:${JSON.stringify(patch)}`)
      return chain
    },
    maybeSingle: async () => ({ data: apiKeyRows[0] ?? null }),
    then: (resolve: (v: { data: unknown; error: null }) => void) =>
      resolve({ data: table === 'profiles' ? [] : apiKeyRows, error: null }),
  }
  return chain
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: (t: string) => makeAdminQuery(t) }),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: currentUser } }) },
    from: () => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: myRoles[0] ?? null }),
        then: (resolve: (v: { data: unknown; error: null }) => void) => resolve({ data: myRoles, error: null }),
      }
      return chain
    },
  }),
}))

vi.mock('@/lib/mcp/oauth/store', () => ({
  revokeConnection: async (id: string) => {
    revokedIds.push(id)
  },
}))

const { GET } = await import('@/app/api/oauth/connections/route')
const { DELETE } = await import('@/app/api/oauth/connections/[id]/route')

beforeEach(() => {
  currentUser = { id: 'user-1' }
  myRoles = []
  adminQueries.length = 0
  apiKeyRows = []
  revokedIds = []
})

describe('GET /api/oauth/connections — 見える範囲', () => {
  it('ログインしていなければ 401', async () => {
    currentUser = null
    expect((await GET()).status).toBe(401)
  })

  it('オーナーの組織が無ければ、自分の接続だけに絞る', async () => {
    myRoles = [{ org_id: 'org-1', role: 'member' }]
    await GET()

    const keysQuery = adminQueries.find((q) => q.table === 'api_keys')!
    expect(keysQuery.filters).toContain('eq:user_id=user-1')
    expect(keysQuery.filters.some((f) => f.startsWith('or:'))).toBe(false)
  })

  it('オーナーの組織があれば、その組織の分も含める', async () => {
    myRoles = [{ org_id: 'org-owned', role: 'owner' }]
    await GET()

    const keysQuery = adminQueries.find((q) => q.table === 'api_keys')!
    const or = keysQuery.filters.find((f) => f.startsWith('or:'))
    expect(or).toContain('user_id.eq.user-1')
    expect(or).toContain('org-owned')
  })

  it('画面で発行した鍵は出さない（外部チャットの接続だけ）', async () => {
    await GET()
    const keysQuery = adminQueries.find((q) => q.table === 'api_keys')!
    expect(keysQuery.filters).toContain('eq:issued_via=oauth')
  })
})

describe('DELETE /api/oauth/connections/[id] — 解除できる人', () => {
  const ctx = { params: Promise.resolve({ id: 'conn-1' }) }

  it('ログインしていなければ 401', async () => {
    currentUser = null
    expect((await DELETE(new Request('https://x.test'), ctx)).status).toBe(401)
    expect(revokedIds).toEqual([])
  })

  it('本人の接続なら解除できる', async () => {
    apiKeyRows = [{ id: 'conn-1', org_id: 'org-1', user_id: 'user-1', issued_via: 'oauth' }]
    const res = await DELETE(new Request('https://x.test'), ctx)
    expect(res.status).toBe(200)
    expect(revokedIds).toEqual(['conn-1'])
  })

  it('他人の接続でも、その組織のオーナーなら解除できる', async () => {
    apiKeyRows = [{ id: 'conn-1', org_id: 'org-1', user_id: 'other', issued_via: 'oauth' }]
    myRoles = [{ org_id: 'org-1', role: 'owner' }]
    const res = await DELETE(new Request('https://x.test'), ctx)
    expect(res.status).toBe(200)
    expect(revokedIds).toEqual(['conn-1'])
  })

  it('他人の接続で、ただのメンバーなら解除できない', async () => {
    apiKeyRows = [{ id: 'conn-1', org_id: 'org-1', user_id: 'other', issued_via: 'oauth' }]
    myRoles = [{ org_id: 'org-1', role: 'member' }]
    const res = await DELETE(new Request('https://x.test'), ctx)
    expect(res.status).toBe(403)
    expect(revokedIds).toEqual([])
  })

  it('画面で発行した鍵は、この口からは解除できない', async () => {
    apiKeyRows = [{ id: 'conn-1', org_id: 'org-1', user_id: 'user-1', issued_via: 'manual' }]
    const res = await DELETE(new Request('https://x.test'), ctx)
    expect(res.status).toBe(404)
    expect(revokedIds).toEqual([])
  })

  it('見つからない接続は 404', async () => {
    apiKeyRows = []
    const res = await DELETE(new Request('https://x.test'), ctx)
    expect(res.status).toBe(404)
    expect(revokedIds).toEqual([])
  })
})
