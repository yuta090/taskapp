import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * GET /api/channels/group-claims/pending — 共有botグループ紐付けの確認待ち一覧（Stage 4・PR3a）
 * 内部メンバーのみ。promoteのdigest承認(listPendingApprovalsForUser)とは別store関数を使う。
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

const storeMock = { listPendingGroupClaimsForOrg: vi.fn() }
vi.mock('@/lib/channels/store', () => storeMock)

const { GET } = await import('@/app/api/channels/group-claims/pending/route')

const ORG_ID = '11111111-1111-4111-8111-111111111111'

function callGet(orgId?: string, channel?: string) {
  const url = new URL('http://localhost:3000/api/channels/group-claims/pending')
  if (orgId !== undefined) url.searchParams.set('orgId', orgId)
  if (channel !== undefined) url.searchParams.set('channel', channel)
  return GET(new NextRequest(url, { method: 'GET' }))
}

describe('GET /api/channels/group-claims/pending', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getUserMock.mockResolvedValue({ data: { user: { id: 'staff-1' } }, error: null })
    membershipSingleMock.mockResolvedValue({ data: { role: 'member' }, error: null })
    storeMock.listPendingGroupClaimsForOrg.mockResolvedValue([])
  })

  it('orgIdが無ければ400', async () => {
    const res = await callGet(undefined)
    expect(res.status).toBe(400)
  })

  it('未ログインは401', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const res = await callGet(ORG_ID)
    expect(res.status).toBe(401)
  })

  it('内部メンバーでなければ403', async () => {
    membershipSingleMock.mockResolvedValue({ data: { role: 'client' }, error: null })
    const res = await callGet(ORG_ID)
    expect(res.status).toBe(403)
  })

  it('自orgのpending claim一覧を返す', async () => {
    storeMock.listPendingGroupClaimsForOrg.mockResolvedValue([
      { id: 'claim-1', externalGroupId: 'G-1', spaceId: 'space-1', spaceName: '山田商事', challengeLabel: 'AB12', groupDisplayNameSnapshot: 'ある会社の相談グループ', createdAt: '2026-07-16T00:00:00Z' },
    ])
    const res = await callGet(ORG_ID)
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(storeMock.listPendingGroupClaimsForOrg).toHaveBeenCalledWith(ORG_ID)
    expect(json.items).toHaveLength(1)
    expect(json.items[0].spaceName).toBe('山田商事')
  })

  it('channel を渡すと、そのチャネルの確認待ちだけを store に求める（Slack のページ用）', async () => {
    await callGet(ORG_ID, 'slack')
    expect(storeMock.listPendingGroupClaimsForOrg).toHaveBeenCalledWith(ORG_ID, 'slack')
  })

  it('channel が registry に無い値なら400', async () => {
    const res = await callGet(ORG_ID, 'fax')
    expect(res.status).toBe(400)
  })

  it('channel=line は通る（LINE の承認画面がここで落ちると承認が丸ごと止まる）', async () => {
    const res = await callGet(ORG_ID, 'line')
    expect(res.status).toBe(200)
    expect(storeMock.listPendingGroupClaimsForOrg).toHaveBeenCalledWith(ORG_ID, 'line')
  })
})
