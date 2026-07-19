import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/channels/group-claims/issue — 共有botグループ紐付けコード発行（web_approval・Stage 4・PR3a）
 * 内部メンバーのみ。spaceが自org内かを検証し、単一のplatform accountへ発行する。
 * 生codeは1度きり表示コードとして返す（DBにはhashのみ残る）。
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

const verifySpaceInOrgMock = vi.fn()
const findFirstPlatformAccountIdMock = vi.fn()
const createSharedGroupClaimCodeMock = vi.fn()
const orgLineGroupCapacityMock = vi.fn()

class DuplicateSharedGroupClaimCodeError extends Error {}
class MultiplePlatformAccountsError extends Error {}

vi.mock('@/lib/channels/store', () => ({
  verifySpaceInOrg: (...args: unknown[]) => verifySpaceInOrgMock(...args),
  findFirstPlatformAccountId: (...args: unknown[]) => findFirstPlatformAccountIdMock(...args),
  createSharedGroupClaimCode: (...args: unknown[]) => createSharedGroupClaimCodeMock(...args),
  orgLineGroupCapacity: (...args: unknown[]) => orgLineGroupCapacityMock(...args),
  DuplicateSharedGroupClaimCodeError,
  MultiplePlatformAccountsError,
}))

const { POST } = await import('@/app/api/channels/group-claims/issue/route')

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const SPACE_ID = '22222222-2222-4222-8222-222222222222'

function callPost(body: Record<string, unknown>) {
  return POST(
    new NextRequest('http://localhost:3000/api/channels/group-claims/issue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

describe('POST /api/channels/group-claims/issue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // hashSharedGroupClaimCode(実装/未モック)がfail-closedするため発行系テストにはpepperが必須
    process.env.SHARED_GROUP_CLAIM_PEPPER = 'test-pepper'
    getUserMock.mockResolvedValue({ data: { user: { id: 'staff-1' } }, error: null })
    membershipSingleMock.mockResolvedValue({ data: { role: 'admin' }, error: null })
    verifySpaceInOrgMock.mockResolvedValue(true)
    orgLineGroupCapacityMock.mockResolvedValue({ activeCount: 0, maxGroups: null }) // 既定=無制限
    findFirstPlatformAccountIdMock.mockResolvedValue('acc-platform-1')
    createSharedGroupClaimCodeMock.mockResolvedValue({
      id: 'code-1',
      expiresAt: '2026-07-16T00:30:00.000Z',
    })
  })

  afterEach(() => {
    delete process.env.SHARED_GROUP_CLAIM_PEPPER
  })

  it('orgId/spaceId欠落は400', async () => {
    const res = await callPost({ orgId: ORG_ID })
    expect(res.status).toBe(400)
  })

  it('未ログインは401', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const res = await callPost({ orgId: ORG_ID, spaceId: SPACE_ID })
    expect(res.status).toBe(401)
  })

  it('内部メンバーでなければ403', async () => {
    membershipSingleMock.mockResolvedValue({ data: null, error: { message: 'not found' } })
    const res = await callPost({ orgId: ORG_ID, spaceId: SPACE_ID })
    expect(res.status).toBe(403)
  })

  it('グループ上限到達なら402で早期に止める（コードを発行しない）', async () => {
    orgLineGroupCapacityMock.mockResolvedValue({ activeCount: 3, maxGroups: 3 })
    const res = await callPost({ orgId: ORG_ID, spaceId: SPACE_ID })
    const json = await res.json()
    expect(res.status).toBe(402)
    expect(json.code).toBe('group_limit_reached')
    expect(createSharedGroupClaimCodeMock).not.toHaveBeenCalled()
  })

  it('spaceが自org内でなければ404（他orgへの発行防止）', async () => {
    verifySpaceInOrgMock.mockResolvedValue(false)
    const res = await callPost({ orgId: ORG_ID, spaceId: SPACE_ID })
    expect(res.status).toBe(404)
    expect(createSharedGroupClaimCodeMock).not.toHaveBeenCalled()
  })

  it('platform accountが無ければ400「共有bot未設定」', async () => {
    findFirstPlatformAccountIdMock.mockResolvedValue(null)
    const res = await callPost({ orgId: ORG_ID, spaceId: SPACE_ID })
    expect(res.status).toBe(400)
    expect(createSharedGroupClaimCodeMock).not.toHaveBeenCalled()
  })

  it('複数のactive platform accountが存在する場合は409（L2ガード・明示選択が未対応）', async () => {
    findFirstPlatformAccountIdMock.mockRejectedValue(new MultiplePlatformAccountsError())
    const res = await callPost({ orgId: ORG_ID, spaceId: SPACE_ID })
    expect(res.status).toBe(409)
    expect(createSharedGroupClaimCodeMock).not.toHaveBeenCalled()
  })

  it('成功: GC-プレフィクス付き表示コードとexpiresAtを返す', async () => {
    const res = await callPost({ orgId: ORG_ID, spaceId: SPACE_ID })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.code).toMatch(/^GC-[A-Z2-9]{6}-[A-Z2-9]{5}-[A-Z2-9]{5}-[A-Z2-9]{5}-[A-Z2-9]{5}$/)
    expect(json.expiresAt).toBe('2026-07-16T00:30:00.000Z')

    expect(createSharedGroupClaimCodeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: ORG_ID,
        spaceId: SPACE_ID,
        targetAccountId: 'acc-platform-1',
        createdBy: 'staff-1',
        codeHash: expect.any(String),
        expiresAt: expect.any(String),
      }),
    )
  })

  it('code_hash衝突(23505)はリトライして成功する', async () => {
    createSharedGroupClaimCodeMock
      .mockRejectedValueOnce(new DuplicateSharedGroupClaimCodeError())
      .mockResolvedValueOnce({ id: 'code-2', expiresAt: '2026-07-16T00:30:00.000Z' })

    const res = await callPost({ orgId: ORG_ID, spaceId: SPACE_ID })
    expect(res.status).toBe(200)
    expect(createSharedGroupClaimCodeMock).toHaveBeenCalledTimes(2)
  })

  it('リトライ上限(3回)を超える衝突は500', async () => {
    createSharedGroupClaimCodeMock.mockRejectedValue(new DuplicateSharedGroupClaimCodeError())
    const res = await callPost({ orgId: ORG_ID, spaceId: SPACE_ID })
    expect(res.status).toBe(500)
    expect(createSharedGroupClaimCodeMock).toHaveBeenCalledTimes(3)
  })

  it('想定外のDBエラーは500', async () => {
    createSharedGroupClaimCodeMock.mockRejectedValue(new Error('boom'))
    const res = await callPost({ orgId: ORG_ID, spaceId: SPACE_ID })
    expect(res.status).toBe(500)
    expect(createSharedGroupClaimCodeMock).toHaveBeenCalledTimes(1)
  })
})
