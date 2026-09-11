import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * 上限確認 API（/api/billing/limits）。
 *
 * 守るべき不変条件:
 *   - 上限を返す DB 関数（rpc_check_org_limits）を呼ぶのは、本人のその組織への所属を
 *     確かめたあと・管理用の鍵（service role）からだけ（本人のセッションからは呼ばない）。
 *   - 401 / 二要素認証の拒否 / 不正な org_id / 未所属の org_id のときは、
 *     管理用の鍵を作らず・RPC も呼ばない。
 *   - 返す JSON の形（フラット構造）は変えない。
 */

const mockCreateAdminClient = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => mockCreateAdminClient(),
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

const mockResolveOrgEntitlements = vi.fn()
vi.mock('@/lib/billing/entitlements', async () => {
  const actual = await vi.importActual<typeof import('@/lib/billing/entitlements')>(
    '@/lib/billing/entitlements',
  )
  return {
    PLAN_FEATURES: actual.PLAN_FEATURES,
    resolveOrgEntitlements: (...args: unknown[]) => mockResolveOrgEntitlements(...args),
  }
})

import { GET } from '@/app/api/billing/limits/route'
import { createClient } from '@/lib/supabase/server'

const ORG_ID = '11111111-2222-3333-4444-555555555555'
const OTHER_ORG_ID = '99999999-2222-3333-4444-555555555555'

// DB 側の実際の定義（supabase/migrations/20260726190731_billing_quotes.sql の
// rpc_check_org_limits）が返す形。storage だけ current_bytes/limit_bytes という
// 名前で、他（projects/members/clients）は current/limit。
const RPC_DATA = {
  plan_name: 'Pro',
  projects: { limit: 10, current: 1 },
  members: { limit: 5, current: 2 },
  clients: { limit: 20, current: 3 },
  storage: { limit_bytes: 1_000_000, current_bytes: 500 },
}

/** org_memberships への問い合わせの eq 呼び出し引数を記録する箱 */
let membershipEqCalls: Array<[string, string]> = []

/** org_memberships への問い合わせだけを再現する最小の chainable builder */
function membershipBuilder(row: { org_id: string; role: string } | null) {
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn((column: string, value: string) => {
    membershipEqCalls.push([column, value])
    return builder
  })
  builder.order = vi.fn(() => builder)
  builder.limit = vi.fn(() => builder)
  builder.single = vi.fn(async () => ({ data: row, error: row ? null : { message: 'not found' } }))
  builder.maybeSingle = vi.fn(async () => ({ data: row, error: null }))
  return builder
}

function makeSupabase(opts: {
  user: { id: string; factors?: Array<{ status: string }> } | null
  membershipRow?: { org_id: string; role: string } | null
}): SupabaseClient {
  const auth = {
    getUser: vi.fn(async () => ({ data: { user: opts.user }, error: null })),
    getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
  }
  const from = vi.fn((table: string) => {
    if (table === 'org_memberships') return membershipBuilder(opts.membershipRow ?? null)
    return membershipBuilder(null)
  })
  const rpc = vi.fn()
  return { auth, from, rpc } as unknown as SupabaseClient
}

function req(url: string): NextRequest {
  return new NextRequest(url)
}

beforeEach(() => {
  vi.clearAllMocks()
  membershipEqCalls = []
  mockResolveOrgEntitlements.mockResolvedValue({ planId: 'pro', has: () => true })
})

describe('GET /api/billing/limits — 未ログイン・二要素認証未完了', () => {
  it('未ログインは401で、管理用の鍵を作らない', async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabase({ user: null }))

    const res = await GET(req(`http://localhost/api/billing/limits?org_id=${ORG_ID}`))

    expect(res.status).toBe(401)
    expect(mockCreateAdminClient).not.toHaveBeenCalled()
  })

  it('二要素認証のコード未入力（登録済み×aal1）は403で、管理用の鍵を作らない', async () => {
    vi.mocked(createClient).mockResolvedValue(
      makeSupabase({
        user: { id: 'u1', factors: [{ status: 'verified' }] },
        membershipRow: { org_id: ORG_ID, role: 'owner' },
      }),
    )

    const res = await GET(req(`http://localhost/api/billing/limits?org_id=${ORG_ID}`))

    expect(res.status).toBe(403)
    expect(mockCreateAdminClient).not.toHaveBeenCalled()
  })
})

describe('GET /api/billing/limits — 入力検査', () => {
  it('org_id がUUID形式でなければ400で、管理用の鍵を作らない', async () => {
    vi.mocked(createClient).mockResolvedValue(
      makeSupabase({ user: { id: 'u1' }, membershipRow: { org_id: ORG_ID, role: 'owner' } }),
    )

    const res = await GET(req('http://localhost/api/billing/limits?org_id=not-a-uuid'))

    expect(res.status).toBe(400)
    expect(mockCreateAdminClient).not.toHaveBeenCalled()
  })

  it('指定した org_id に所属していなければ403で、管理用の鍵を作らない', async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabase({ user: { id: 'u1' }, membershipRow: null }))

    const res = await GET(req(`http://localhost/api/billing/limits?org_id=${OTHER_ORG_ID}`))

    expect(res.status).toBe(403)
    expect(mockCreateAdminClient).not.toHaveBeenCalled()
  })

  it('所属確認は本人のuser_idと指定org_idの両方で問い合わせている', async () => {
    vi.mocked(createClient).mockResolvedValue(
      makeSupabase({ user: { id: 'u1' }, membershipRow: { org_id: ORG_ID, role: 'owner' } }),
    )
    mockCreateAdminClient.mockReturnValue({ rpc: vi.fn(async () => ({ data: RPC_DATA, error: null })), from: vi.fn() })

    await GET(req(`http://localhost/api/billing/limits?org_id=${ORG_ID}`))

    expect(membershipEqCalls).toContainEqual(['user_id', 'u1'])
    expect(membershipEqCalls).toContainEqual(['org_id', ORG_ID])
  })

  it('org_id未指定で、どの組織にも所属していなければ404で、管理用の鍵を作らない', async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabase({ user: { id: 'u1' }, membershipRow: null }))

    const res = await GET(req('http://localhost/api/billing/limits'))

    expect(res.status).toBe(404)
    expect(mockCreateAdminClient).not.toHaveBeenCalled()
  })
})

describe('GET /api/billing/limits — 所属確認後は管理用の鍵からRPCを呼ぶ', () => {
  it('org_id 指定・所属あり: 本人のセッションからは呼ばず、管理用の鍵で確かめた org_id を呼ぶ', async () => {
    const sessionSupabase = makeSupabase({
      user: { id: 'u1' },
      membershipRow: { org_id: ORG_ID, role: 'owner' },
    })
    vi.mocked(createClient).mockResolvedValue(sessionSupabase)

    const adminRpc = vi.fn(async () => ({ data: RPC_DATA, error: null }))
    mockCreateAdminClient.mockReturnValue({ rpc: adminRpc, from: vi.fn() })

    const res = await GET(req(`http://localhost/api/billing/limits?org_id=${ORG_ID}`))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockCreateAdminClient).toHaveBeenCalledTimes(1)
    expect(adminRpc).toHaveBeenCalledWith('rpc_check_org_limits', { p_org_id: ORG_ID })
    expect(sessionSupabase.rpc).not.toHaveBeenCalled()

    // 返す JSON の形（フラット構造）は変わらない
    expect(body).toEqual({
      plan_name: 'Pro',
      projects_limit: 10,
      projects_used: 1,
      members_limit: 5,
      members_used: 2,
      clients_limit: 20,
      clients_used: 3,
      storage_limit_bytes: 1_000_000,
      storage_used_bytes: 500,
      features: expect.any(Array),
    })
  })

  it('容量はDBが返す current_bytes/limit_bytes の名前で正しく読める（current/limit ではない）', async () => {
    vi.mocked(createClient).mockResolvedValue(
      makeSupabase({ user: { id: 'u1' }, membershipRow: { org_id: ORG_ID, role: 'owner' } }),
    )
    mockCreateAdminClient.mockReturnValue({
      rpc: vi.fn(async () => ({
        data: { ...RPC_DATA, storage: { limit_bytes: 2_000_000_000, current_bytes: 12_345 } },
        error: null,
      })),
      from: vi.fn(),
    })

    const res = await GET(req(`http://localhost/api/billing/limits?org_id=${ORG_ID}`))
    const body = await res.json()

    expect(body.storage_limit_bytes).toBe(2_000_000_000)
    expect(body.storage_used_bytes).toBe(12_345)
  })

  it('org_id 未指定（cookie/既定組織）でも、所属が確かめられた org_id で管理用の鍵から呼ぶ', async () => {
    const sessionSupabase = makeSupabase({
      user: { id: 'u1' },
      membershipRow: { org_id: ORG_ID, role: 'member' },
    })
    vi.mocked(createClient).mockResolvedValue(sessionSupabase)

    const adminRpc = vi.fn(async () => ({ data: RPC_DATA, error: null }))
    mockCreateAdminClient.mockReturnValue({ rpc: adminRpc, from: vi.fn() })

    const res = await GET(req('http://localhost/api/billing/limits'))

    expect(res.status).toBe(200)
    expect(adminRpc).toHaveBeenCalledWith('rpc_check_org_limits', { p_org_id: ORG_ID })
    expect(sessionSupabase.rpc).not.toHaveBeenCalled()
  })

  it('RPCがエラーを返しても、DBのエラー文言をそのまま利用者へ返さない', async () => {
    vi.mocked(createClient).mockResolvedValue(
      makeSupabase({ user: { id: 'u1' }, membershipRow: { org_id: ORG_ID, role: 'owner' } }),
    )
    const adminRpc = vi.fn(async () => ({ data: null, error: { message: 'internal secret detail' } }))
    mockCreateAdminClient.mockReturnValue({ rpc: adminRpc, from: vi.fn() })

    const res = await GET(req(`http://localhost/api/billing/limits?org_id=${ORG_ID}`))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(JSON.stringify(body)).not.toContain('internal secret detail')
  })
})
