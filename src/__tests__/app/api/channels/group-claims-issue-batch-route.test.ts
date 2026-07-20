import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/channels/group-claims/issue-batch — code_only の本部一括発行（Stage 4・PR3b）
 *
 * owner/adminのみ。entitlement(allow_code_only)が無いorgは拒否。全spaceIdが自org内かを検証。
 * 発行レート上限（org単位の未消費code_onlyコード数）を超える一括発行は拒否。
 * 対象accountはPR3aと同じくサーバ側解決（複数botはL2ガードで409）。
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

const isCodeOnlyEntitledMock = vi.fn()
const verifySpacesInOrgMock = vi.fn()
const countOutstandingCodeOnlyCodesMock = vi.fn()
const findFirstPlatformAccountIdMock = vi.fn()
const createCodeOnlyClaimCodesBatchMock = vi.fn()
const getLineSelfServeStateMock = vi.fn()

class MultiplePlatformAccountsError extends Error {}

vi.mock('@/lib/channels/store', () => ({
  isCodeOnlyEntitled: (...args: unknown[]) => isCodeOnlyEntitledMock(...args),
  verifySpacesInOrg: (...args: unknown[]) => verifySpacesInOrgMock(...args),
  countOutstandingCodeOnlyCodes: (...args: unknown[]) => countOutstandingCodeOnlyCodesMock(...args),
  findFirstPlatformAccountId: (...args: unknown[]) => findFirstPlatformAccountIdMock(...args),
  createCodeOnlyClaimCodesBatch: (...args: unknown[]) => createCodeOnlyClaimCodesBatchMock(...args),
  getLineSelfServeState: (...args: unknown[]) => getLineSelfServeStateMock(...args),
  MultiplePlatformAccountsError,
}))

const { POST } = await import('@/app/api/channels/group-claims/issue-batch/route')

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const SPACE_1 = '22222222-2222-4222-8222-222222222222'
const SPACE_2 = '33333333-3333-4333-8333-333333333333'

function callPost(body: Record<string, unknown>) {
  return POST(
    new NextRequest('http://localhost:3000/api/channels/group-claims/issue-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

describe('POST /api/channels/group-claims/issue-batch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getUserMock.mockResolvedValue({ data: { user: { id: 'staff-1' } }, error: null })
    membershipSingleMock.mockResolvedValue({ data: { role: 'admin' }, error: null })
    isCodeOnlyEntitledMock.mockResolvedValue(true)
    getLineSelfServeStateMock.mockResolvedValue('granted')
    verifySpacesInOrgMock.mockResolvedValue(true)
    countOutstandingCodeOnlyCodesMock.mockResolvedValue(0)
    findFirstPlatformAccountIdMock.mockResolvedValue('acc-platform-1')
    createCodeOnlyClaimCodesBatchMock.mockResolvedValue([
      { spaceId: SPACE_1, displayCode: 'GC-AAAAAA-BBBBB-CCCCC-DDDDD-EEEEE' },
      { spaceId: SPACE_2, displayCode: 'GC-FFFFFF-GGGGG-HHHHH-JJJJJ-KKKKK' },
    ])
  })

  it('orgId/spaceIds欠落は400', async () => {
    const res = await callPost({ orgId: ORG_ID })
    expect(res.status).toBe(400)
  })

  it('spaceIdsが空配列は400', async () => {
    const res = await callPost({ orgId: ORG_ID, spaceIds: [] })
    expect(res.status).toBe(400)
  })

  it('spaceIdsに不正なUUIDが混じれば400', async () => {
    const res = await callPost({ orgId: ORG_ID, spaceIds: [SPACE_1, 'not-a-uuid'] })
    expect(res.status).toBe(400)
  })

  it('spaceIds(重複排除後)が上限(50)を超える一括発行は早期に400（DB往復の前に弾く）', async () => {
    const spaceIds = Array.from(
      { length: 51 },
      (_, i) => `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`,
    )
    const res = await callPost({ orgId: ORG_ID, spaceIds })
    expect(res.status).toBe(400)
    // 早期リターン: 後続のDB往復系(entitlement/verifySpacesInOrg等)を一切呼ばない
    expect(isCodeOnlyEntitledMock).not.toHaveBeenCalled()
    expect(verifySpacesInOrgMock).not.toHaveBeenCalled()
    expect(createCodeOnlyClaimCodesBatchMock).not.toHaveBeenCalled()
  })

  it('未ログインは401', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const res = await callPost({ orgId: ORG_ID, spaceIds: [SPACE_1] })
    expect(res.status).toBe(401)
  })

  it('member(owner/admin以外)は403（owner/admin限定）', async () => {
    membershipSingleMock.mockResolvedValue({ data: { role: 'member' }, error: null })
    const res = await callPost({ orgId: ORG_ID, spaceIds: [SPACE_1] })
    expect(res.status).toBe(403)
  })

  it('entitlement(allow_code_only)が無いorgは403', async () => {
    isCodeOnlyEntitledMock.mockResolvedValue(false)
    const res = await callPost({ orgId: ORG_ID, spaceIds: [SPACE_1] })
    expect(res.status).toBe(403)
    expect(createCodeOnlyClaimCodesBatchMock).not.toHaveBeenCalled()
  })

  it('他orgのspaceが混じっていれば404', async () => {
    verifySpacesInOrgMock.mockResolvedValue(false)
    const res = await callPost({ orgId: ORG_ID, spaceIds: [SPACE_1, SPACE_2] })
    expect(res.status).toBe(404)
    expect(createCodeOnlyClaimCodesBatchMock).not.toHaveBeenCalled()
  })

  it('発行レート上限（未消費コード数+今回分>50）を超える一括発行は429', async () => {
    countOutstandingCodeOnlyCodesMock.mockResolvedValue(49)
    const res = await callPost({ orgId: ORG_ID, spaceIds: [SPACE_1, SPACE_2] })
    expect(res.status).toBe(429)
    expect(createCodeOnlyClaimCodesBatchMock).not.toHaveBeenCalled()
  })

  it('platform accountが無ければ400', async () => {
    findFirstPlatformAccountIdMock.mockResolvedValue(null)
    const res = await callPost({ orgId: ORG_ID, spaceIds: [SPACE_1] })
    expect(res.status).toBe(400)
  })

  it('複数のactive platform accountが存在する場合は409（L2ガード）', async () => {
    findFirstPlatformAccountIdMock.mockRejectedValue(new MultiplePlatformAccountsError())
    const res = await callPost({ orgId: ORG_ID, spaceIds: [SPACE_1] })
    expect(res.status).toBe(409)
  })

  it('成功: 発行したコード一覧とexpiresAtを返す', async () => {
    const res = await callPost({ orgId: ORG_ID, spaceIds: [SPACE_1, SPACE_2] })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.items).toEqual([
      { spaceId: SPACE_1, displayCode: 'GC-AAAAAA-BBBBB-CCCCC-DDDDD-EEEEE' },
      { spaceId: SPACE_2, displayCode: 'GC-FFFFFF-GGGGG-HHHHH-JJJJJ-KKKKK' },
    ])
    expect(typeof json.expiresAt).toBe('string')

    expect(createCodeOnlyClaimCodesBatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: ORG_ID,
        spaceIds: [SPACE_1, SPACE_2],
        targetAccountId: 'acc-platform-1',
        createdBy: 'staff-1',
      }),
    )
  })

  it('想定外のDBエラーは500', async () => {
    createCodeOnlyClaimCodesBatchMock.mockRejectedValue(new Error('boom'))
    const res = await callPost({ orgId: ORG_ID, spaceIds: [SPACE_1] })
    expect(res.status).toBe(500)
  })
})
