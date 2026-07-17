import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * GET /api/channels/digest-tasks/pending — 確認待ちトレイ（Stage 2.7-B §5）
 * 内部メンバーのみ。セッションユーザー宛の pending 候補を返す。
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

const storeMock = { listPendingApprovalsForUser: vi.fn() }
vi.mock('@/lib/channels/store', () => storeMock)

const { GET } = await import('@/app/api/channels/digest-tasks/pending/route')

const ORG_ID = '11111111-1111-4111-8111-111111111111'

function callGet(orgId?: string) {
  const url = new URL('http://localhost:3000/api/channels/digest-tasks/pending')
  if (orgId !== undefined) url.searchParams.set('orgId', orgId)
  return GET(new NextRequest(url, { method: 'GET' }))
}

describe('GET /api/channels/digest-tasks/pending', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getUserMock.mockResolvedValue({ data: { user: { id: 'staff-1' } }, error: null })
    membershipSingleMock.mockResolvedValue({ data: { role: 'member' }, error: null })
    storeMock.listPendingApprovalsForUser.mockResolvedValue([])
  })

  it('orgId が無ければ400', async () => {
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

  it('セッションユーザー宛の pending をそのユーザーIDで引いて返す', async () => {
    storeMock.listPendingApprovalsForUser.mockResolvedValue([
      { taskId: 'task-1', title: '発注', groupName: 'A社', dueDate: '2026-07-20', dueTime: null },
    ])
    const res = await callGet(ORG_ID)
    const json = await res.json()
    expect(res.status).toBe(200)
    // 必ず「本人のuserId」でスコープする（他人の承認待ちを見せない）
    expect(storeMock.listPendingApprovalsForUser).toHaveBeenCalledWith(ORG_ID, 'staff-1')
    expect(json.items).toHaveLength(1)
    expect(json.items[0].title).toBe('発注')
  })
})
