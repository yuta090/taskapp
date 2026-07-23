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
const getLineSelfServeStateMock = vi.fn()
const orgExternalChatGroupCapacityMock = vi.fn()

class DuplicateSharedGroupClaimCodeError extends Error {}
class MultiplePlatformAccountsError extends Error {}

vi.mock('@/lib/channels/store', () => ({
  verifySpaceInOrg: (...args: unknown[]) => verifySpaceInOrgMock(...args),
  findFirstPlatformAccountId: (...args: unknown[]) => findFirstPlatformAccountIdMock(...args),
  createSharedGroupClaimCode: (...args: unknown[]) => createSharedGroupClaimCodeMock(...args),
  orgLineGroupCapacity: (...args: unknown[]) => orgLineGroupCapacityMock(...args),
  getLineSelfServeState: (...args: unknown[]) => getLineSelfServeStateMock(...args),
  orgExternalChatGroupCapacity: (...args: unknown[]) => orgExternalChatGroupCapacityMock(...args),
  DuplicateSharedGroupClaimCodeError,
  MultiplePlatformAccountsError,
}))

const resolveOrgEntitlementsMock = vi.fn()
vi.mock('@/lib/billing/entitlements', () => ({
  resolveOrgEntitlements: (...args: unknown[]) => resolveOrgEntitlementsMock(...args),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))

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
    getLineSelfServeStateMock.mockResolvedValue('granted') // 既定=開通済み
    orgLineGroupCapacityMock.mockResolvedValue({ activeCount: 0, maxGroups: null }) // 既定=無制限
    orgExternalChatGroupCapacityMock.mockResolvedValue({ activeCount: 0, max: null }) // 既定=無制限
    resolveOrgEntitlementsMock.mockResolvedValue({ has: (f: string) => f === 'external_chat_channels' })
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

  it('共通LINE未申込(none)なら403（発行しない・申込導線コード）', async () => {
    getLineSelfServeStateMock.mockResolvedValue('none')
    const res = await callPost({ orgId: ORG_ID, spaceId: SPACE_ID })
    const json = await res.json()
    expect(res.status).toBe(403)
    expect(json.code).toBe('shared_bot_access_required')
    expect(createSharedGroupClaimCodeMock).not.toHaveBeenCalled()
  })

  it('申込中(requested)でも403（未開通は発行しない）', async () => {
    getLineSelfServeStateMock.mockResolvedValue('requested')
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

  it('channel省略時は line 経路になる（findFirstPlatformAccountIdに"line"が渡る）', async () => {
    await callPost({ orgId: ORG_ID, spaceId: SPACE_ID })
    expect(findFirstPlatformAccountIdMock).toHaveBeenCalledWith('line')
    // line経路のゲート関数が呼ばれる（google_chat側のゲートは呼ばれない）
    expect(getLineSelfServeStateMock).toHaveBeenCalledWith(ORG_ID)
    expect(orgLineGroupCapacityMock).toHaveBeenCalledWith(ORG_ID)
    expect(resolveOrgEntitlementsMock).not.toHaveBeenCalled()
    expect(orgExternalChatGroupCapacityMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/channels/group-claims/issue — channel対応(google_chat等)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.SHARED_GROUP_CLAIM_PEPPER = 'test-pepper'
    getUserMock.mockResolvedValue({ data: { user: { id: 'staff-1' } }, error: null })
    membershipSingleMock.mockResolvedValue({ data: { role: 'admin' }, error: null })
    verifySpaceInOrgMock.mockResolvedValue(true)
    orgExternalChatGroupCapacityMock.mockResolvedValue({ activeCount: 0, max: null })
    resolveOrgEntitlementsMock.mockResolvedValue({ has: (f: string) => f === 'external_chat_channels' })
    findFirstPlatformAccountIdMock.mockResolvedValue('acc-gchat-platform-1')
    createSharedGroupClaimCodeMock.mockResolvedValue({
      id: 'code-1',
      expiresAt: '2026-07-16T00:30:00.000Z',
    })
  })

  afterEach(() => {
    delete process.env.SHARED_GROUP_CLAIM_PEPPER
  })

  it('不明channelは400', async () => {
    const res = await callPost({ orgId: ORG_ID, spaceId: SPACE_ID, channel: 'bogus_channel' })
    expect(res.status).toBe(400)
    expect(createSharedGroupClaimCodeMock).not.toHaveBeenCalled()
  })

  it('entitled＋容量内: google_chat の platform account を対象にコード発行成功（LINEゲートは呼ばれない）', async () => {
    const res = await callPost({ orgId: ORG_ID, spaceId: SPACE_ID, channel: 'google_chat' })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.code).toMatch(/^GC-/)

    expect(findFirstPlatformAccountIdMock).toHaveBeenCalledWith('google_chat')
    expect(orgExternalChatGroupCapacityMock).toHaveBeenCalledWith(ORG_ID, 'google_chat')
    expect(createSharedGroupClaimCodeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: ORG_ID,
        spaceId: SPACE_ID,
        targetAccountId: 'acc-gchat-platform-1',
        createdBy: 'staff-1',
      }),
    )
    // LINE専用のゲート関数は一切呼ばれない
    expect(getLineSelfServeStateMock).not.toHaveBeenCalled()
    expect(orgLineGroupCapacityMock).not.toHaveBeenCalled()
  })

  it('未entitled(external_chat_channels無し)は402 external_chat_channels_required', async () => {
    resolveOrgEntitlementsMock.mockResolvedValue({ has: () => false })
    const res = await callPost({ orgId: ORG_ID, spaceId: SPACE_ID, channel: 'google_chat' })
    const json = await res.json()
    expect(res.status).toBe(402)
    expect(json.code).toBe('external_chat_channels_required')
    expect(createSharedGroupClaimCodeMock).not.toHaveBeenCalled()
  })

  it('容量超過は402 group_limit_reached（コードを発行しない）', async () => {
    orgExternalChatGroupCapacityMock.mockResolvedValue({ activeCount: 5, max: 5 })
    const res = await callPost({ orgId: ORG_ID, spaceId: SPACE_ID, channel: 'google_chat' })
    const json = await res.json()
    expect(res.status).toBe(402)
    expect(json.code).toBe('group_limit_reached')
    expect(createSharedGroupClaimCodeMock).not.toHaveBeenCalled()
  })

  it('platform accountが無ければ400「共有bot未設定」', async () => {
    findFirstPlatformAccountIdMock.mockResolvedValue(null)
    const res = await callPost({ orgId: ORG_ID, spaceId: SPACE_ID, channel: 'google_chat' })
    expect(res.status).toBe(400)
    expect(createSharedGroupClaimCodeMock).not.toHaveBeenCalled()
  })

  it('複数のactive platform accountが存在する場合は409', async () => {
    findFirstPlatformAccountIdMock.mockRejectedValue(new MultiplePlatformAccountsError())
    const res = await callPost({ orgId: ORG_ID, spaceId: SPACE_ID, channel: 'google_chat' })
    expect(res.status).toBe(409)
    expect(createSharedGroupClaimCodeMock).not.toHaveBeenCalled()
  })

  it('spaceが自org内でなければ404', async () => {
    verifySpaceInOrgMock.mockResolvedValue(false)
    const res = await callPost({ orgId: ORG_ID, spaceId: SPACE_ID, channel: 'google_chat' })
    expect(res.status).toBe(404)
    expect(createSharedGroupClaimCodeMock).not.toHaveBeenCalled()
  })
})
