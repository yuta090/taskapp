import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * ディスク使用量 API（/api/storage/usage）。
 *
 * 守るべき不変条件:
 *   - 集計の DB 関数（org_storage_usage）は、所属を確かめたあと・管理用の鍵からだけ呼ぶ。
 *   - 組織全体の内訳（プロジェクト名つき）を見られるのは組織の社内メンバー（owner/member）だけ。
 *   - プロジェクト1つ分は、そのプロジェクトの社内メンバー（client/vendor 以外）だけ。
 *     返すのはそのプロジェクトの行だけ（他のプロジェクトの数字を混ぜない）。
 */

const mockAdminRpc = vi.fn()
const mockAdminSpaces = vi.fn()
const mockCreateAdminClient = vi.fn(() => ({
  rpc: mockAdminRpc,
  from: vi.fn(() => {
    const b: Record<string, unknown> = {}
    b.select = vi.fn(() => b)
    b.eq = vi.fn(() => b)
    b.then = (resolve: (v: unknown) => unknown) => resolve(mockAdminSpaces())
    return b
  }),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => mockCreateAdminClient(),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { GET } from '@/app/api/storage/usage/route'
import { createClient } from '@/lib/supabase/server'

const ORG_ID = '11111111-2222-3333-4444-555555555555'
const SPACE_A = 'aaaaaaaa-2222-3333-4444-555555555555'
const SPACE_B = 'bbbbbbbb-2222-3333-4444-555555555555'

function single(row: unknown) {
  const b: Record<string, unknown> = {}
  b.select = vi.fn(() => b)
  b.eq = vi.fn(() => b)
  b.maybeSingle = vi.fn(async () => ({ data: row, error: null }))
  b.single = vi.fn(async () => ({ data: row, error: row ? null : { message: 'not found' } }))
  return b
}

function makeSupabase(opts: {
  user: { id: string; factors?: Array<{ status: string }> } | null
  orgRole?: string | null
  space?: { org_id: string } | null
  spaceRole?: string | null
}): SupabaseClient {
  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: opts.user }, error: null })),
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
    },
    from: vi.fn((table: string) => {
      if (table === 'org_memberships') return single(opts.orgRole ? { role: opts.orgRole } : null)
      if (table === 'spaces') return single(opts.space ?? null)
      if (table === 'space_memberships') return single(opts.spaceRole ? { role: opts.spaceRole } : null)
      return single(null)
    }),
  } as unknown as SupabaseClient
}

const USAGE_ROWS = [
  { space_id: SPACE_A, bytes: 3000, file_count: 3 },
  { space_id: SPACE_B, bytes: 5000, file_count: 1 },
  { space_id: null, bytes: 200, file_count: 2 },
]

function req(query: string) {
  return new NextRequest(`http://localhost/api/storage/usage?${query}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAdminRpc.mockResolvedValue({ data: USAGE_ROWS, error: null })
  mockAdminSpaces.mockReturnValue({
    data: [
      { id: SPACE_A, name: 'A案件' },
      { id: SPACE_B, name: 'B案件' },
      { id: 'cccccccc-2222-3333-4444-555555555555', name: '空の案件' },
    ],
    error: null,
  })
})

describe('GET /api/storage/usage — 入口の検査', () => {
  it('未ログインは401で、管理用の鍵を作らない', async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabase({ user: null }))
    const res = await GET(req(`org_id=${ORG_ID}`))
    expect(res.status).toBe(401)
    expect(mockCreateAdminClient).not.toHaveBeenCalled()
  })

  it('二要素認証のコード未入力は403で、管理用の鍵を作らない', async () => {
    vi.mocked(createClient).mockResolvedValue(
      makeSupabase({ user: { id: 'u1', factors: [{ status: 'verified' }] }, orgRole: 'owner' }),
    )
    const res = await GET(req(`org_id=${ORG_ID}`))
    expect(res.status).toBe(403)
    expect(mockCreateAdminClient).not.toHaveBeenCalled()
  })

  it('org_id が無い・UUID でないときは400', async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabase({ user: { id: 'u1' }, orgRole: 'owner' }))
    expect((await GET(req(''))).status).toBe(400)
    expect((await GET(req('org_id=x'))).status).toBe(400)
    expect((await GET(req(`org_id=${ORG_ID}&space_id=x`))).status).toBe(400)
    expect(mockCreateAdminClient).not.toHaveBeenCalled()
  })
})

describe('GET /api/storage/usage — 組織全体', () => {
  it('オーナーには合計・チャットの添付・プロジェクトごとの内訳（多い順・0件の案件も）を返す', async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabase({ user: { id: 'u1' }, orgRole: 'owner' }))
    const res = await GET(req(`org_id=${ORG_ID}`))
    expect(res.status).toBe(200)
    expect(mockAdminRpc).toHaveBeenCalledWith('org_storage_usage', { p_org_id: ORG_ID, p_space_id: null })
    expect(await res.json()).toEqual({
      total_bytes: 8200,
      chat_attachments_bytes: 200,
      spaces: [
        { space_id: SPACE_B, name: 'B案件', bytes: 5000, file_count: 1 },
        { space_id: SPACE_A, name: 'A案件', bytes: 3000, file_count: 3 },
        { space_id: 'cccccccc-2222-3333-4444-555555555555', name: '空の案件', bytes: 0, file_count: 0 },
      ],
    })
  })

  it('社内メンバー（member）にも内訳を返す', async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabase({ user: { id: 'u1' }, orgRole: 'member' }))
    const res = await GET(req(`org_id=${ORG_ID}`))
    expect(res.status).toBe(200)
  })

  it.each(['client', null])('社内メンバー以外（%s）は403で、集計を呼ばない', async (role) => {
    vi.mocked(createClient).mockResolvedValue(makeSupabase({ user: { id: 'u1' }, orgRole: role }))
    const res = await GET(req(`org_id=${ORG_ID}`))
    expect(res.status).toBe(403)
    expect(mockAdminRpc).not.toHaveBeenCalled()
  })
})

describe('GET /api/storage/usage — プロジェクト1つ', () => {
  it('社内メンバーには、そのプロジェクトの分だけを返す', async () => {
    vi.mocked(createClient).mockResolvedValue(
      makeSupabase({ user: { id: 'u1' }, space: { org_id: ORG_ID }, spaceRole: 'member' }),
    )
    const res = await GET(req(`org_id=${ORG_ID}&space_id=${SPACE_A}`))
    expect(res.status).toBe(200)
    expect(mockAdminRpc).toHaveBeenCalledWith('org_storage_usage', { p_org_id: ORG_ID, p_space_id: SPACE_A })
    expect(await res.json()).toEqual({ space_id: SPACE_A, bytes: 3000, file_count: 3 })
  })

  it('ファイルが1つも無いプロジェクトは 0 を返す', async () => {
    mockAdminRpc.mockResolvedValue({ data: [], error: null })
    vi.mocked(createClient).mockResolvedValue(
      makeSupabase({ user: { id: 'u1' }, space: { org_id: ORG_ID }, spaceRole: 'admin' }),
    )
    const res = await GET(req(`org_id=${ORG_ID}&space_id=${SPACE_A}`))
    expect(await res.json()).toEqual({ space_id: SPACE_A, bytes: 0, file_count: 0 })
  })

  it.each(['client', 'vendor', null])('社内メンバーでない（%s）は403で、集計を呼ばない', async (role) => {
    vi.mocked(createClient).mockResolvedValue(
      makeSupabase({ user: { id: 'u1' }, space: { org_id: ORG_ID }, spaceRole: role }),
    )
    const res = await GET(req(`org_id=${ORG_ID}&space_id=${SPACE_A}`))
    expect(res.status).toBe(403)
    expect(mockAdminRpc).not.toHaveBeenCalled()
  })

  it('別の組織のプロジェクトを指定したら403', async () => {
    vi.mocked(createClient).mockResolvedValue(
      makeSupabase({
        user: { id: 'u1' },
        space: { org_id: '99999999-2222-3333-4444-555555555555' },
        spaceRole: 'member',
      }),
    )
    const res = await GET(req(`org_id=${ORG_ID}&space_id=${SPACE_A}`))
    expect(res.status).toBe(403)
    expect(mockAdminRpc).not.toHaveBeenCalled()
  })
})
