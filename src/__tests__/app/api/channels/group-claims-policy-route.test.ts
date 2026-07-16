import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * GET /api/channels/group-claims/policy?orgId=... — code_only entitlement の読取（Stage 4・PR3b）
 * GroupLinksClientが「本部一括発行(code_only)」セクションを表示するかの判定に使う。
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
vi.mock('@/lib/channels/store', () => ({
  isCodeOnlyEntitled: (...args: unknown[]) => isCodeOnlyEntitledMock(...args),
}))

const { GET } = await import('@/app/api/channels/group-claims/policy/route')

const ORG_ID = '11111111-1111-4111-8111-111111111111'

function callGet(orgId?: string) {
  const url = orgId
    ? `http://localhost:3000/api/channels/group-claims/policy?orgId=${orgId}`
    : 'http://localhost:3000/api/channels/group-claims/policy'
  return GET(new NextRequest(url))
}

describe('GET /api/channels/group-claims/policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getUserMock.mockResolvedValue({ data: { user: { id: 'staff-1' } }, error: null })
    membershipSingleMock.mockResolvedValue({ data: { role: 'member' }, error: null })
    isCodeOnlyEntitledMock.mockResolvedValue(false)
  })

  it('orgId欠落は400', async () => {
    const res = await callGet()
    expect(res.status).toBe(400)
  })

  it('未ログインは401', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const res = await callGet(ORG_ID)
    expect(res.status).toBe(401)
  })

  it('内部メンバーでなければ403', async () => {
    membershipSingleMock.mockResolvedValue({ data: null, error: { message: 'not found' } })
    const res = await callGet(ORG_ID)
    expect(res.status).toBe(403)
  })

  it('allowCodeOnly=trueをそのまま返す', async () => {
    isCodeOnlyEntitledMock.mockResolvedValue(true)
    const res = await callGet(ORG_ID)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ allowCodeOnly: true })
  })

  it('allowCodeOnly=falseをそのまま返す', async () => {
    isCodeOnlyEntitledMock.mockResolvedValue(false)
    const res = await callGet(ORG_ID)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ allowCodeOnly: false })
  })
})
