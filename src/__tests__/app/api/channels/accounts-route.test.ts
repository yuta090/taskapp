import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * GET/PATCH /api/channels/accounts — 秘書コンソールのbot状態カード用
 *
 * - GET: 内部メンバー(owner/admin/member)なら閲覧可。credentials_encryptedは絶対に返さない
 * - PATCH: owner/adminのみ。accountIdの実所属org(サーバ側で解決)に対して認可判定する
 *   (クライアント申告のorgIdではなく、accountId→org_idの逆引きを信用する)
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
  findChannelAccountMetaForOrg: vi.fn(),
  findChannelAccountOrgId: vi.fn(),
  updateChannelAccountStatus: vi.fn(),
  orgUsesSharedBot: vi.fn(),
}
vi.mock('@/lib/channels/store', () => storeMock)

const { GET, PATCH } = await import('@/app/api/channels/accounts/route')

const ORG_A = '11111111-1111-4111-8111-111111111111'
const ORG_B = '99999999-9999-4999-8999-999999999999'
const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222'

const accountMeta = {
  id: ACCOUNT_ID,
  orgId: ORG_A,
  channel: 'line',
  displayName: '山田会計事務所',
  lineBotUserId: 'U-bot-1',
  status: 'active' as const,
  createdAt: '2026-07-01T00:00:00.000Z',
  ownerType: 'org' as const,
}

function callGet(orgId: string | null) {
  const url = orgId
    ? `http://localhost:3000/api/channels/accounts?orgId=${orgId}`
    : 'http://localhost:3000/api/channels/accounts'
  return GET(new NextRequest(url))
}

function callPatch(body: Record<string, unknown>) {
  const request = new NextRequest('http://localhost:3000/api/channels/accounts', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return PATCH(request)
}

describe('GET /api/channels/accounts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getUserMock.mockResolvedValue({ data: { user: { id: 'staff-1' } }, error: null })
    membershipSingleMock.mockResolvedValue({ data: { role: 'member' }, error: null })
    storeMock.findChannelAccountMetaForOrg.mockResolvedValue(accountMeta)
    storeMock.orgUsesSharedBot.mockResolvedValue(false)
  })

  it('orgId欠落は400', async () => {
    const response = await callGet(null)
    expect(response.status).toBe(400)
  })

  it('orgId不正形式は400', async () => {
    const response = await callGet('not-a-uuid')
    expect(response.status).toBe(400)
  })

  it('未ログインは401', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const response = await callGet(ORG_A)
    expect(response.status).toBe(401)
  })

  it('内部メンバーでない(client)は403', async () => {
    membershipSingleMock.mockResolvedValue({ data: { role: 'client' }, error: null })
    const response = await callGet(ORG_A)
    expect(response.status).toBe(403)
  })

  it('memberは閲覧できるがviewerRoleがmemberで返る', async () => {
    const response = await callGet(ORG_A)
    const json = await response.json()
    expect(response.status).toBe(200)
    expect(json.viewerRole).toBe('member')
  })

  it('成功: 秘密列を含まないメタ情報のみ返す', async () => {
    const response = await callGet(ORG_A)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.account).toEqual({
      id: ACCOUNT_ID,
      channel: 'line',
      displayName: '山田会計事務所',
      lineBotUserId: 'U-bot-1',
      status: 'active',
      createdAt: '2026-07-01T00:00:00.000Z',
      ownerType: 'org',
    })
    expect(json.account.credentials_encrypted).toBeUndefined()
    expect(json.account.credentialsEncrypted).toBeUndefined()
  })

  it('未登録org: account=null, sharedBotInUse=false', async () => {
    storeMock.findChannelAccountMetaForOrg.mockResolvedValue(null)
    storeMock.orgUsesSharedBot.mockResolvedValue(false)
    const response = await callGet(ORG_A)
    const json = await response.json()
    expect(response.status).toBe(200)
    expect(json.account).toBeNull()
    expect(json.sharedBotInUse).toBe(false)
  })

  it('自社LINE無し・共通LINEのグループあり → sharedBotInUse=true', async () => {
    storeMock.findChannelAccountMetaForOrg.mockResolvedValue(null)
    storeMock.orgUsesSharedBot.mockResolvedValue(true)
    const response = await callGet(ORG_A)
    const json = await response.json()
    expect(response.status).toBe(200)
    expect(json.account).toBeNull()
    expect(json.sharedBotInUse).toBe(true)
  })

  it('自社LINEありなら共通判定は呼ばず sharedBotInUse=false', async () => {
    storeMock.findChannelAccountMetaForOrg.mockResolvedValue(accountMeta)
    const response = await callGet(ORG_A)
    const json = await response.json()
    expect(json.account.ownerType).toBe('org')
    expect(json.sharedBotInUse).toBe(false)
    expect(storeMock.orgUsesSharedBot).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/channels/accounts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getUserMock.mockResolvedValue({ data: { user: { id: 'staff-1' } }, error: null })
    membershipSingleMock.mockResolvedValue({ data: { role: 'owner' }, error: null })
    storeMock.findChannelAccountOrgId.mockResolvedValue(ORG_A)
    storeMock.updateChannelAccountStatus.mockResolvedValue({ ...accountMeta, status: 'disabled' })
  })

  it('accountId欠落は400', async () => {
    const response = await callPatch({ status: 'disabled' })
    expect(response.status).toBe(400)
  })

  it('status不正値は400', async () => {
    const response = await callPatch({ accountId: ACCOUNT_ID, status: 'paused' })
    expect(response.status).toBe(400)
  })

  it('存在しないaccountIdは404', async () => {
    storeMock.findChannelAccountOrgId.mockResolvedValue(null)
    const response = await callPatch({ accountId: ACCOUNT_ID, status: 'disabled' })
    expect(response.status).toBe(404)
    expect(storeMock.updateChannelAccountStatus).not.toHaveBeenCalled()
  })

  it('未ログインは401', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const response = await callPatch({ accountId: ACCOUNT_ID, status: 'disabled' })
    expect(response.status).toBe(401)
  })

  it('member(owner/adminでない)は403', async () => {
    membershipSingleMock.mockResolvedValue({ data: { role: 'member' }, error: null })
    const response = await callPatch({ accountId: ACCOUNT_ID, status: 'disabled' })
    expect(response.status).toBe(403)
    expect(storeMock.updateChannelAccountStatus).not.toHaveBeenCalled()
  })

  it('他orgのowner: accountIdの実所属org(A)に対する権限が無ければ403', async () => {
    // このユーザーはORG_Bのownerだが、対象accountはORG_A所属
    storeMock.findChannelAccountOrgId.mockResolvedValue(ORG_A)
    membershipSingleMock.mockResolvedValue({ data: null, error: { message: 'no rows' } })
    const response = await callPatch({ accountId: ACCOUNT_ID, status: 'disabled' })
    expect(response.status).toBe(403)
  })

  it('owner: 成功して更新後のstatusを返す', async () => {
    const response = await callPatch({ accountId: ACCOUNT_ID, status: 'disabled' })
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(storeMock.updateChannelAccountStatus).toHaveBeenCalledWith(ACCOUNT_ID, 'disabled')
    expect(json.account.status).toBe('disabled')
  })

  it('admin: 成功する', async () => {
    membershipSingleMock.mockResolvedValue({ data: { role: 'admin' }, error: null })
    const response = await callPatch({ accountId: ACCOUNT_ID, status: 'active' })
    expect(response.status).toBe(200)
  })

  void ORG_B
})
