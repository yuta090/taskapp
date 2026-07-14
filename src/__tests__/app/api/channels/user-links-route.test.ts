import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 内部ユーザーの LINE 本人紐付け API（Stage 2.7-A）
 *
 * 最重要: 発行対象の user_id を *リクエストから受け取らない*。
 *   service_role で INSERT するため、body の userId を信じると
 *   低権限ユーザーが org owner の UUID を指定してコードを発行し、
 *   自分のLINEを owner として紐付けられる（confused deputy）。
 *   → 必ず検証済みセッションから導出する。
 */

const authzMock = {
  requireInternalMember: vi.fn(),
  requireOrgAdmin: vi.fn(),
}
vi.mock('@/lib/channels/authz', () => authzMock)

const storeMock = {
  createUserLinkCode: vi.fn(),
  listActiveUserLinks: vi.fn(),
  revokeUserLink: vi.fn(),
  findUserLinkById: vi.fn(),
  findChannelAccountMetaForOrg: vi.fn(),
}
vi.mock('@/lib/channels/store', () => storeMock)

const { POST: issueCode } = await import('@/app/api/channels/user-links/code/route')
const { GET: listLinks, DELETE: revokeLink } = await import('@/app/api/channels/user-links/route')

const ORG = '11111111-1111-4111-8111-111111111111'
const OTHER_ORG = '22222222-2222-4222-8222-222222222222'
const ACCOUNT = '33333333-3333-4333-8333-333333333333'
const ME = '44444444-4444-4444-8444-444444444444'
const OWNER = '55555555-5555-4555-8555-555555555555'
const LINK = '66666666-6666-4666-8666-666666666666'

function post(body: unknown) {
  return new Request('http://localhost/api/channels/user-links/code', {
    method: 'POST',
    body: JSON.stringify(body),
  }) as never
}

function del(body: unknown) {
  return new Request('http://localhost/api/channels/user-links', {
    method: 'DELETE',
    body: JSON.stringify(body),
  }) as never
}

beforeEach(() => {
  vi.clearAllMocks()
  authzMock.requireInternalMember.mockResolvedValue({ ok: true, userId: ME, role: 'member' })
  authzMock.requireOrgAdmin.mockResolvedValue({ ok: false, status: 403, error: 'Owner or admin only' })
  storeMock.findChannelAccountMetaForOrg.mockResolvedValue({ id: ACCOUNT, displayName: 'OA' })
  storeMock.createUserLinkCode.mockResolvedValue(undefined)
  storeMock.listActiveUserLinks.mockResolvedValue([])
  storeMock.revokeUserLink.mockResolvedValue(true)
  storeMock.findUserLinkById.mockResolvedValue({ id: LINK, orgId: ORG, userId: ME })
})

describe('POST /api/channels/user-links/code', () => {
  it('コードを発行し、平文を一度だけ返す（DBにはハッシュのみ）', async () => {
    const res = await issueCode(post({ orgId: ORG, channelAccountId: ACCOUNT }))
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.code).toMatch(/^TA-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/)

    // DBへ渡すのは sha256。平文は渡さない
    const [, , , codeHash] = storeMock.createUserLinkCode.mock.calls[0]
    expect(codeHash).toMatch(/^[0-9a-f]{64}$/)
    expect(codeHash).not.toContain(json.code)
  })

  it('body の userId は信用せず、セッションのユーザーで発行する', async () => {
    // 攻撃: 低権限ユーザーが owner の UUID を指定してコードを発行しようとする
    const res = await issueCode(post({ orgId: ORG, channelAccountId: ACCOUNT, userId: OWNER }))
    expect(res.status).toBe(200)

    const [, userId] = storeMock.createUserLinkCode.mock.calls[0]
    expect(userId).toBe(ME) // セッションのユーザー
    expect(userId).not.toBe(OWNER)
  })

  it('org の内部メンバーでなければ 403', async () => {
    authzMock.requireInternalMember.mockResolvedValue({
      ok: false,
      status: 403,
      error: 'Internal members only',
    })
    const res = await issueCode(post({ orgId: ORG, channelAccountId: ACCOUNT }))
    expect(res.status).toBe(403)
    expect(storeMock.createUserLinkCode).not.toHaveBeenCalled()
  })

  it('自orgのOAでないIDを指定しても発行しない（クロステナント）', async () => {
    // org に紐づく OA は別ID → 指定されたIDは他orgのもの
    storeMock.findChannelAccountMetaForOrg.mockResolvedValue({ id: OTHER_ORG, displayName: 'OA' })
    const res = await issueCode(post({ orgId: ORG, channelAccountId: ACCOUNT }))
    expect(res.status).toBe(404)
    expect(storeMock.createUserLinkCode).not.toHaveBeenCalled()
  })

  it('OAが未登録なら発行しない', async () => {
    storeMock.findChannelAccountMetaForOrg.mockResolvedValue(null)
    const res = await issueCode(post({ orgId: ORG, channelAccountId: ACCOUNT }))
    expect(res.status).toBe(404)
  })

  it('不正なUUIDは400', async () => {
    const res = await issueCode(post({ orgId: 'not-a-uuid', channelAccountId: ACCOUNT }))
    expect(res.status).toBe(400)
  })
})

describe('DELETE /api/channels/user-links（失効）', () => {
  it('本人は自分の紐付けを失効できる', async () => {
    const res = await revokeLink(del({ orgId: ORG, linkId: LINK }))
    expect(res.status).toBe(200)
    expect(storeMock.revokeUserLink).toHaveBeenCalledWith(LINK, ME)
  })

  it('他人の紐付けは、org admin でなければ失効できない', async () => {
    storeMock.findUserLinkById.mockResolvedValue({ id: LINK, orgId: ORG, userId: OWNER })
    const res = await revokeLink(del({ orgId: ORG, linkId: LINK }))
    expect(res.status).toBe(403)
    expect(storeMock.revokeUserLink).not.toHaveBeenCalled()
  })

  it('org admin は他人の紐付けを失効できる（退職者対応）', async () => {
    storeMock.findUserLinkById.mockResolvedValue({ id: LINK, orgId: ORG, userId: OWNER })
    authzMock.requireOrgAdmin.mockResolvedValue({ ok: true, userId: ME, role: 'owner' })
    const res = await revokeLink(del({ orgId: ORG, linkId: LINK }))
    expect(res.status).toBe(200)
    expect(storeMock.revokeUserLink).toHaveBeenCalledWith(LINK, ME)
  })

  it('他orgの紐付けは触れない', async () => {
    storeMock.findUserLinkById.mockResolvedValue({ id: LINK, orgId: OTHER_ORG, userId: ME })
    const res = await revokeLink(del({ orgId: ORG, linkId: LINK }))
    expect(res.status).toBe(404)
    expect(storeMock.revokeUserLink).not.toHaveBeenCalled()
  })

  it('二重失効は 200 だが revoked=false（副作用ゼロ）', async () => {
    storeMock.revokeUserLink.mockResolvedValue(false)
    const res = await revokeLink(del({ orgId: ORG, linkId: LINK }))
    expect(res.status).toBe(200)
    expect((await res.json()).revoked).toBe(false)
  })
})

describe('GET /api/channels/user-links（一覧）', () => {
  it('内部メンバーは org の紐付け一覧を取得できる', async () => {
    storeMock.listActiveUserLinks.mockResolvedValue([{ id: LINK, userId: ME }])
    const req = new Request(`http://localhost/api/channels/user-links?orgId=${ORG}`) as never
    const res = await listLinks(req)
    expect(res.status).toBe(200)
    expect((await res.json()).links).toHaveLength(1)
  })

  it('LINE userId（個人識別子）は wire に出さない', async () => {
    storeMock.listActiveUserLinks.mockResolvedValue([
      { id: LINK, userId: ME, externalUserId: 'U-secret-line-id', linkedAt: '2026-07-15' },
    ])
    const req = new Request(`http://localhost/api/channels/user-links?orgId=${ORG}`) as never
    const res = await listLinks(req)

    const text = JSON.stringify(await res.json())
    expect(text).not.toContain('U-secret-line-id')
  })

  it('内部メンバーでなければ 403', async () => {
    authzMock.requireInternalMember.mockResolvedValue({
      ok: false,
      status: 403,
      error: 'Internal members only',
    })
    const req = new Request(`http://localhost/api/channels/user-links?orgId=${ORG}`) as never
    const res = await listLinks(req)
    expect(res.status).toBe(403)
  })
})
