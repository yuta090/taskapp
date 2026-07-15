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
  isOrgInternalMember: vi.fn(),
  isSpaceApproverEligible: vi.fn(),
  setGroupApprover: vi.fn(),
  listOrgGroupsWithApprover: vi.fn(),
}
vi.mock('@/lib/channels/store', () => storeMock)

const { PATCH, GET } = await import('@/app/api/channels/groups/route')

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
  pickupMode: 'all',
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
    storeMock.isOrgInternalMember.mockResolvedValue(true)
    storeMock.isSpaceApproverEligible.mockResolvedValue(true)
    storeMock.setGroupApprover.mockResolvedValue(undefined)
    storeMock.listOrgGroupsWithApprover.mockResolvedValue([])
  })

  describe('GET（承認フロー設定用のグループ一覧）', () => {
    function callGet(orgId?: string) {
      const url = new URL('http://localhost:3000/api/channels/groups')
      if (orgId !== undefined) url.searchParams.set('orgId', orgId)
      return GET(new NextRequest(url, { method: 'GET' }))
    }

    it('orgId 無しは400', async () => {
      expect((await callGet(undefined)).status).toBe(400)
    })

    it('内部メンバーでなければ403', async () => {
      membershipSingleMock.mockResolvedValue({ data: { role: 'client' }, error: null })
      expect((await callGet(ORG_ID)).status).toBe(403)
    })

    it('active＋space紐付け済みグループと現承認者を返す', async () => {
      storeMock.listOrgGroupsWithApprover.mockResolvedValue([
        { groupId: 'g1', displayName: '厨房', spaceId: 's1', spaceName: 'A社', approverUserId: 'u1' },
      ])
      const res = await callGet(ORG_ID)
      const json = await res.json()
      expect(res.status).toBe(200)
      expect(storeMock.listOrgGroupsWithApprover).toHaveBeenCalledWith(ORG_ID)
      expect(json.groups[0]).toMatchObject({ groupId: 'g1', approverUserId: 'u1' })
    })
  })

  it('未ログインは401', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const response = await callPatch({ orgId: ORG_ID, groupId: GROUP_ID, pickupMode: 'off' })
    expect(response.status).toBe(401)
  })

  it('内部メンバーでなければ403', async () => {
    membershipSingleMock.mockResolvedValue({ data: { role: 'client' }, error: null })
    const response = await callPatch({ orgId: ORG_ID, groupId: GROUP_ID, pickupMode: 'off' })
    expect(response.status).toBe(403)
  })

  it('他orgのgroupIdは404', async () => {
    storeMock.verifyGroupInOrg.mockResolvedValue(null)
    const response = await callPatch({ orgId: ORG_ID, groupId: GROUP_ID, pickupMode: 'off' })
    expect(response.status).toBe(404)
    expect(storeMock.updateChannelGroup).not.toHaveBeenCalled()
  })

  it('更新項目が無ければ400', async () => {
    const response = await callPatch({ orgId: ORG_ID, groupId: GROUP_ID })
    expect(response.status).toBe(400)
  })

  it('pickupModeを更新できる', async () => {
    const response = await callPatch({ orgId: ORG_ID, groupId: GROUP_ID, pickupMode: 'mention_only' })
    expect(response.status).toBe(200)
    expect(storeMock.updateChannelGroup).toHaveBeenCalledWith(GROUP_ID, { pickupMode: 'mention_only' })
  })

  it('pickupModeが3値以外なら400', async () => {
    const response = await callPatch({ orgId: ORG_ID, groupId: GROUP_ID, pickupMode: 'invalid' })
    expect(response.status).toBe(400)
    expect(storeMock.updateChannelGroup).not.toHaveBeenCalled()
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

  const APPROVER = '33333333-3333-4333-8333-333333333333'

  it('approver変更は一般メンバーには不可（403）', async () => {
    membershipSingleMock.mockResolvedValue({ data: { role: 'member' }, error: null })
    const response = await callPatch({ orgId: ORG_ID, groupId: GROUP_ID, approverUserId: APPROVER })
    expect(response.status).toBe(403)
    expect(storeMock.setGroupApprover).not.toHaveBeenCalled()
  })

  it('admin＋space admin/editor 検証を通れば setGroupApprover を原子的に呼ぶ', async () => {
    membershipSingleMock.mockResolvedValue({ data: { role: 'admin' }, error: null })
    const response = await callPatch({ orgId: ORG_ID, groupId: GROUP_ID, approverUserId: APPROVER })
    expect(response.status).toBe(200)
    expect(storeMock.isSpaceApproverEligible).toHaveBeenCalledWith('space-1', APPROVER)
    expect(storeMock.setGroupApprover).toHaveBeenCalledWith(GROUP_ID, APPROVER)
  })

  it('approver が space の admin/editor でなければ400（宙吊り防止）', async () => {
    membershipSingleMock.mockResolvedValue({ data: { role: 'admin' }, error: null })
    storeMock.isSpaceApproverEligible.mockResolvedValue(false)
    const response = await callPatch({ orgId: ORG_ID, groupId: GROUP_ID, approverUserId: APPROVER })
    expect(response.status).toBe(400)
    expect(storeMock.setGroupApprover).not.toHaveBeenCalled()
  })

  it('space 未紐付けグループに approver を設定しようとすると400', async () => {
    membershipSingleMock.mockResolvedValue({ data: { role: 'admin' }, error: null })
    storeMock.verifyGroupInOrg.mockResolvedValue({ ...GROUP, spaceId: null })
    const response = await callPatch({ orgId: ORG_ID, groupId: GROUP_ID, approverUserId: APPROVER })
    expect(response.status).toBe(400)
    expect(storeMock.setGroupApprover).not.toHaveBeenCalled()
  })

  it('approverUserId=null は admin による解除として setGroupApprover(null) を呼ぶ（eligibility不要）', async () => {
    membershipSingleMock.mockResolvedValue({ data: { role: 'admin' }, error: null })
    const response = await callPatch({ orgId: ORG_ID, groupId: GROUP_ID, approverUserId: null })
    expect(response.status).toBe(200)
    expect(storeMock.isSpaceApproverEligible).not.toHaveBeenCalled()
    expect(storeMock.setGroupApprover).toHaveBeenCalledWith(GROUP_ID, null)
  })

  it('approverUserId が不正な文字列なら400', async () => {
    membershipSingleMock.mockResolvedValue({ data: { role: 'admin' }, error: null })
    const response = await callPatch({ orgId: ORG_ID, groupId: GROUP_ID, approverUserId: 'not-a-uuid' })
    expect(response.status).toBe(400)
    expect(storeMock.setGroupApprover).not.toHaveBeenCalled()
  })

  it('non-object body (null) は400（500にしない）', async () => {
    const request = new NextRequest('http://localhost:3000/api/channels/groups', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: 'null',
    })
    const response = await PATCH(request)
    expect(response.status).toBe(400)
  })
})
