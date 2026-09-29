import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * createRouteAuth: スマホアプリ（Bearer トークン）とブラウザ（Cookie）の両方から呼ばれるルート用の本人確認。
 * 採用しているルートだけが Bearer を受け付ける（src/lib/supabase/server.ts の createClient は Cookie のまま）。
 */

const bearerGetUser = vi.fn()
const createBearerClientMock = vi.fn((_jwt: string) => ({ auth: { getUser: bearerGetUser } }))
vi.mock('@/lib/supabase/bearer', () => ({
  createBearerClient: (jwt: string) => createBearerClientMock(jwt),
}))

const cookieGetUser = vi.fn()
const cookieGetSession = vi.fn()
const cookieCreateClientMock = vi.fn(async () => ({ auth: { getUser: cookieGetUser, getSession: cookieGetSession } }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => cookieCreateClientMock(),
}))

const { createRouteAuth } = await import('@/lib/supabase/routeAuth')

function request(headers: Record<string, string> = {}) {
  return new NextRequest(new URL('/api/x', 'http://localhost:3000'), { method: 'POST', headers })
}

describe('createRouteAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('有効な Bearer トークンなら、そのトークンで本人を確かめ、同じトークンを返す', async () => {
    bearerGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    const auth = await createRouteAuth(request({ authorization: 'Bearer jwt-abc' }))
    expect(createBearerClientMock).toHaveBeenCalledWith('jwt-abc')
    expect(bearerGetUser).toHaveBeenCalledWith('jwt-abc')
    expect(auth).toMatchObject({ user: { id: 'u1' }, accessToken: 'jwt-abc', via: 'bearer' })
  })

  it('無効な Bearer トークンなら null で、Cookie には戻らない（取り違えを防ぐ）', async () => {
    bearerGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'invalid' } })
    expect(await createRouteAuth(request({ authorization: 'Bearer bad' }))).toBeNull()
    expect(cookieCreateClientMock).not.toHaveBeenCalled()
  })

  it('Bearer 以外の Authorization（手前に置いた Basic 認証など）は Cookie のログインで確かめる', async () => {
    cookieGetUser.mockResolvedValue({ data: { user: { id: 'u2' } }, error: null })
    cookieGetSession.mockResolvedValue({ data: { session: { access_token: 'cookie-jwt' } } })
    const auth = await createRouteAuth(request({ authorization: 'Basic abc' }))
    expect(auth).toMatchObject({ user: { id: 'u2' }, via: 'cookie' })
    expect(createBearerClientMock).not.toHaveBeenCalled()
  })

  it('Bearer の後ろが空・空白入りなら null（Cookie に戻らない）', async () => {
    expect(await createRouteAuth(request({ authorization: 'Bearer ' }))).toBeNull()
    expect(await createRouteAuth(request({ authorization: 'Bearer a b' }))).toBeNull()
    expect(cookieCreateClientMock).not.toHaveBeenCalled()
  })

  it('長すぎるトークンは null（確かめに行かない）', async () => {
    expect(await createRouteAuth(request({ authorization: `Bearer ${'a'.repeat(5000)}` }))).toBeNull()
    expect(createBearerClientMock).not.toHaveBeenCalled()
  })

  it('Authorization が無ければ、今までどおり Cookie のログインを使う', async () => {
    cookieGetUser.mockResolvedValue({ data: { user: { id: 'u2' } }, error: null })
    cookieGetSession.mockResolvedValue({ data: { session: { access_token: 'cookie-jwt' } } })
    const auth = await createRouteAuth(request())
    expect(auth).toMatchObject({ user: { id: 'u2' }, accessToken: 'cookie-jwt', via: 'cookie' })
    expect(createBearerClientMock).not.toHaveBeenCalled()
  })

  it('Cookie のログインが無ければ null', async () => {
    cookieGetUser.mockResolvedValue({ data: { user: null }, error: null })
    expect(await createRouteAuth(request())).toBeNull()
  })
})
