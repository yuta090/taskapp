import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * PATCH /api/channels/groups — グループ管理（digest ON/OFF・表示名・unlink）
 *
 * - 内部メンバーのみ。groupIdのorg一致をサーバ側で検証（他org内部ユーザーは404で拒否）
 * - unlink: status='left'化＋openな申し送りタスクのauto-dismiss（store層で実施）
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

const storeMock = {
  verifyGroupInOrg: vi.fn(),
  updateChannelGroup: vi.fn(),
  unlinkGroup: vi.fn(),
}
vi.mock('@/lib/channels/store', () => storeMock)

const { PATCH } = await import('@/app/api/channels/groups/route')

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const GROUP_ID = '22222222-2222-4222-8222-222222222222'

function callPatch(body: Record<string, unknown>) {
  const request = new NextRequest('http://localhost:3000/api/channels/groups', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return PATCH(request)
}

const GROUP = {
  id: GROUP_ID,
  orgId: ORG_ID,
  spaceId: 'space-1',
  accountId: 'acc-1',
  externalGroupId: 'G-1',
  displayName: null,
  status: 'active',
  digestEnabled: true,
  lastExtractedMessageCreatedAt: null,
}

describe('PATCH /api/channels/groups', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getUserMock.mockResolvedValue({ data: { user: { id: 'staff-1' } }, error: null })
    membershipSingleMock.mockResolvedValue({ data: { role: 'member' }, error: null })
    storeMock.verifyGroupInOrg.mockResolvedValue(GROUP)
    storeMock.updateChannelGroup.mockResolvedValue(undefined)
    storeMock.unlinkGroup.mockResolvedValue(undefined)
  })

  it('未ログインは401', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const response = await callPatch({ orgId: ORG_ID, groupId: GROUP_ID, digestEnabled: false })
    expect(response.status).toBe(401)
  })

  it('内部メンバーでなければ403', async () => {
    membershipSingleMock.mockResolvedValue({ data: { role: 'client' }, error: null })
    const response = await callPatch({ orgId: ORG_ID, groupId: GROUP_ID, digestEnabled: false })
    expect(response.status).toBe(403)
  })

  it('他orgのgroupIdは404', async () => {
    storeMock.verifyGroupInOrg.mockResolvedValue(null)
    const response = await callPatch({ orgId: ORG_ID, groupId: GROUP_ID, digestEnabled: false })
    expect(response.status).toBe(404)
    expect(storeMock.updateChannelGroup).not.toHaveBeenCalled()
  })

  it('更新項目が無ければ400', async () => {
    const response = await callPatch({ orgId: ORG_ID, groupId: GROUP_ID })
    expect(response.status).toBe(400)
  })

  it('digestEnabledを更新できる', async () => {
    const response = await callPatch({ orgId: ORG_ID, groupId: GROUP_ID, digestEnabled: false })
    expect(response.status).toBe(200)
    expect(storeMock.updateChannelGroup).toHaveBeenCalledWith(GROUP_ID, { digestEnabled: false })
  })

  it('displayNameを更新できる', async () => {
    const response = await callPatch({ orgId: ORG_ID, groupId: GROUP_ID, displayName: '厨房グループ' })
    expect(response.status).toBe(200)
    expect(storeMock.updateChannelGroup).toHaveBeenCalledWith(GROUP_ID, { displayName: '厨房グループ' })
  })

  it('unlink: statusをleftにし、updateChannelGroupは呼ばない', async () => {
    const response = await callPatch({ orgId: ORG_ID, groupId: GROUP_ID, unlink: true })
    expect(response.status).toBe(200)
    expect(storeMock.unlinkGroup).toHaveBeenCalledWith(GROUP_ID)
    expect(storeMock.updateChannelGroup).not.toHaveBeenCalled()
  })
})
