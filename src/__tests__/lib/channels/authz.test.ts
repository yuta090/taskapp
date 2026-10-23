import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * チャネル配管APIの認可（requireInternalMember / requireOrgAdmin）。
 * 第2引数に request を渡したルートだけが Authorization: Bearer（スマホアプリ）を受け付ける。
 * 渡さないルート、Bearer が無いリクエストは今までどおり Cookie のログインだけで確かめる。
 */

const ORG = '11111111-1111-4111-8111-111111111111'
const USER = '44444444-4444-4444-8444-444444444444'

const cookieGetUser = vi.fn()
const cookieSingle = vi.fn()
const cookieClient = {
  auth: { getUser: cookieGetUser },
  from: vi.fn(() => ({ select: () => ({ eq: () => ({ eq: () => ({ single: cookieSingle }) }) }) })),
}
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => cookieClient }))

const routeAuthMock = vi.fn()
vi.mock('@/lib/supabase/routeAuth', () => ({ createRouteAuth: (req: unknown) => routeAuthMock(req) }))

const mfaGuardMock = vi.fn()
vi.mock('@/lib/auth/apiMfaGuard', () => ({
  mfaGuardResponse: (...args: unknown[]) => mfaGuardMock(...args),
}))

const bearerSingle = vi.fn()
const bearerEq = vi.fn()
const bearerChain: { eq: typeof bearerEq; single: typeof bearerSingle } = {
  eq: (...args: unknown[]) => {
    bearerEq(...args)
    return bearerChain
  },
  single: bearerSingle,
} as never
const bearerFrom = vi.fn(() => ({ select: () => bearerChain }))

const { requireInternalMember, requireOrgAdmin } = await import('@/lib/channels/authz')

function request(headers: Record<string, string> = {}) {
  return new NextRequest(new URL('/api/channels/x', 'http://localhost:3000'), { headers })
}

function bearerAuth() {
  return {
    supabase: { from: bearerFrom },
    user: { id: USER },
    accessToken: 'jwt-abc',
    via: 'bearer' as const,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  cookieGetUser.mockResolvedValue({ data: { user: { id: USER } }, error: null })
  cookieSingle.mockResolvedValue({ data: { role: 'member' } })
  mfaGuardMock.mockResolvedValue(null)
})

describe('Cookie（request を渡さない・Bearer が無い）', () => {
  it('request を渡さなければ従来どおり Cookie で確かめる', async () => {
    const r = await requireInternalMember(ORG)
    expect(r).toEqual({ ok: true, userId: USER, role: 'member' })
    expect(routeAuthMock).not.toHaveBeenCalled()
  })

  it('request を渡しても Authorization が無ければ Cookie（createRouteAuth は呼ばない）', async () => {
    const r = await requireInternalMember(ORG, request())
    expect(r).toEqual({ ok: true, userId: USER, role: 'member' })
    expect(routeAuthMock).not.toHaveBeenCalled()
  })

  it('Basic など Bearer 以外の Authorization も Cookie で確かめる', async () => {
    const r = await requireInternalMember(ORG, request({ authorization: 'Basic abc' }))
    expect(r.ok).toBe(true)
    expect(routeAuthMock).not.toHaveBeenCalled()
  })

  it('Cookie が未ログインなら 401', async () => {
    cookieGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'x' } })
    expect(await requireInternalMember(ORG, request())).toMatchObject({ ok: false, status: 401 })
  })
})

describe('Bearer（request を渡したルートだけ）', () => {
  it('request を渡さないルートは Bearer を付けても Cookie 扱い（401 になる）', async () => {
    cookieGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'x' } })
    expect(await requireInternalMember(ORG)).toMatchObject({ ok: false, status: 401 })
    expect(routeAuthMock).not.toHaveBeenCalled()
  })

  it('有効な Bearer: 本人のトークンのクライアントで所属を引き、userId と role を返す', async () => {
    routeAuthMock.mockResolvedValue(bearerAuth())
    bearerSingle.mockResolvedValue({ data: { role: 'admin' } })
    const r = await requireInternalMember(ORG, request({ authorization: 'Bearer jwt-abc' }))
    expect(r).toEqual({ ok: true, userId: USER, role: 'admin' })
    expect(bearerFrom).toHaveBeenCalledWith('org_memberships')
    expect(cookieGetUser).not.toHaveBeenCalled()
  })

  it('所属の照会は「この組織」かつ「検証済みトークンの本人」で絞る', async () => {
    routeAuthMock.mockResolvedValue(bearerAuth())
    bearerSingle.mockResolvedValue({ data: { role: 'member' } })
    await requireInternalMember(ORG, request({ authorization: 'Bearer jwt-abc' }))
    expect(bearerEq).toHaveBeenCalledWith('org_id', ORG)
    expect(bearerEq).toHaveBeenCalledWith('user_id', USER)
  })

  it.each(['Bearer', 'bearer x', 'Bearer a b'])('Authorization が %j でも Bearer 経路（Cookie には戻らない）', async (h) => {
    routeAuthMock.mockResolvedValue(null)
    expect(await requireInternalMember(ORG, request({ authorization: h }))).toMatchObject({ ok: false, status: 401 })
    expect(routeAuthMock).toHaveBeenCalledTimes(1)
    expect(cookieGetUser).not.toHaveBeenCalled()
  })

  it('requireOrgAdmin: 無効な Bearer は 401、2段階認証が要るトークンは 403 mfa_required のまま返す', async () => {
    routeAuthMock.mockResolvedValueOnce(null)
    expect(await requireOrgAdmin(ORG, request({ authorization: 'Bearer bad' }))).toMatchObject({ ok: false, status: 401 })
    routeAuthMock.mockResolvedValueOnce(bearerAuth())
    mfaGuardMock.mockResolvedValueOnce({ status: 403 })
    expect(await requireOrgAdmin(ORG, request({ authorization: 'Bearer jwt-abc' }))).toEqual({
      ok: false,
      status: 403,
      error: 'mfa_required',
    })
  })

  it('無効な Bearer は 401（Cookie には戻らない）', async () => {
    routeAuthMock.mockResolvedValue(null)
    expect(await requireInternalMember(ORG, request({ authorization: 'Bearer bad' }))).toMatchObject({
      ok: false,
      status: 401,
    })
    expect(cookieGetUser).not.toHaveBeenCalled()
  })

  it('2段階認証が必要なのにコード未入力のトークンは 403 mfa_required（トークンを渡して確かめる）', async () => {
    const auth = bearerAuth()
    routeAuthMock.mockResolvedValue(auth)
    mfaGuardMock.mockResolvedValue({ status: 403 })
    const r = await requireInternalMember(ORG, request({ authorization: 'Bearer jwt-abc' }))
    expect(r).toEqual({ ok: false, status: 403, error: 'mfa_required' })
    expect(mfaGuardMock).toHaveBeenCalledWith(auth.supabase, auth.user, 'jwt-abc')
    expect(bearerSingle).not.toHaveBeenCalled()
  })

  it('組織に所属していなければ 403', async () => {
    routeAuthMock.mockResolvedValue(bearerAuth())
    bearerSingle.mockResolvedValue({ data: null })
    expect(await requireInternalMember(ORG, request({ authorization: 'Bearer jwt-abc' }))).toEqual({
      ok: false,
      status: 403,
      error: 'Internal members only',
    })
  })

  it('相手先（client）・ベンダーは内部メンバーとして通さない', async () => {
    routeAuthMock.mockResolvedValue(bearerAuth())
    bearerSingle.mockResolvedValue({ data: { role: 'client' } })
    expect(await requireInternalMember(ORG, request({ authorization: 'Bearer jwt-abc' }))).toMatchObject({
      ok: false,
      status: 403,
    })
  })

  it('requireOrgAdmin: member は 403、admin は通る', async () => {
    routeAuthMock.mockResolvedValue(bearerAuth())
    bearerSingle.mockResolvedValueOnce({ data: { role: 'member' } })
    expect(await requireOrgAdmin(ORG, request({ authorization: 'Bearer jwt-abc' }))).toEqual({
      ok: false,
      status: 403,
      error: 'Owner or admin only',
    })
    bearerSingle.mockResolvedValueOnce({ data: { role: 'admin' } })
    expect(await requireOrgAdmin(ORG, request({ authorization: 'Bearer jwt-abc' }))).toEqual({
      ok: true,
      userId: USER,
      role: 'admin',
    })
  })
})
