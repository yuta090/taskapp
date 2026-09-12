import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getCachedUser, getCachedUserId, invalidateCachedUser } from '@/lib/supabase/cached-auth'

/**
 * getCachedUser — 起動時のユーザー確認（auth/v1/user）の待ちを減らす（案A）。
 *
 * auth-js の getUser() は、引数無しで呼ぶとロック（同時に1つしか動けない順番札）を
 * 持ったまま認証サーバーに往復する。トークンを渡して呼ぶ（getUser(jwt)）と、
 * このロックを取らずに往復できる（getSession() は既にローカルのセッションを
 * 読むためだけに短くロックを取る）。この2段（getSession→getUser(token)）に
 * 分けることで、ユーザー確認の往復中も他のデータ取得の順番待ちを止めない。
 */

const mockGetUser = vi.fn()
const mockGetSession = vi.fn()

function makeSupabase() {
  return { auth: { getUser: mockGetUser, getSession: mockGetSession } }
}

beforeEach(() => {
  vi.clearAllMocks()
  invalidateCachedUser()
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: 'tok-1', user: { id: 'user-1' } } },
    error: null,
  })
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('getCachedUser', () => {
  it('セッションがあれば getSession() のアクセストークンを渡して getUser(token) を呼ぶ', async () => {
    await getCachedUser(makeSupabase())

    expect(mockGetSession).toHaveBeenCalledTimes(1)
    expect(mockGetUser).toHaveBeenCalledWith('tok-1')
  })

  it('セッションが無ければ、これまでどおり引数無しで getUser() を呼ぶ', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null })
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null })

    const result = await getCachedUser(makeSupabase())

    expect(mockGetUser).toHaveBeenCalledWith(undefined)
    expect(result).toEqual({ user: null, error: null })
  })

  it('getSession() がエラーを返したら、getUser() を呼ばずにそのエラーを返す', async () => {
    const sessionError = new Error('session boom')
    mockGetSession.mockResolvedValue({ data: { session: null }, error: sessionError })

    const result = await getCachedUser(makeSupabase())

    expect(mockGetUser).not.toHaveBeenCalled()
    expect(result).toEqual({ user: null, error: sessionError })
  })

  it('取得した user と error をそのまま返す', async () => {
    const result = await getCachedUser(makeSupabase())
    expect(result).toEqual({ user: { id: 'user-1' }, error: null })
  })

  it('5秒以内の呼び出しは相乗りする（getSession/getUserとも1回だけ）', async () => {
    vi.useFakeTimers()
    const supabase = makeSupabase()

    const [r1, r2] = await Promise.all([getCachedUser(supabase), getCachedUser(supabase)])
    expect(r1).toEqual(r2)
    expect(mockGetSession).toHaveBeenCalledTimes(1)
    expect(mockGetUser).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(4_000)
    await getCachedUser(supabase)
    expect(mockGetSession).toHaveBeenCalledTimes(1)
  })

  it('5秒を過ぎたら取り直す', async () => {
    vi.useFakeTimers()
    const supabase = makeSupabase()

    await getCachedUser(supabase)
    vi.advanceTimersByTime(5_001)
    await getCachedUser(supabase)

    expect(mockGetSession).toHaveBeenCalledTimes(2)
    expect(mockGetUser).toHaveBeenCalledTimes(2)
  })

  it('invalidateCachedUser() のあとは、5秒以内でも取り直す', async () => {
    const supabase = makeSupabase()
    await getCachedUser(supabase)
    invalidateCachedUser()
    await getCachedUser(supabase)

    expect(mockGetSession).toHaveBeenCalledTimes(2)
  })
})

describe('getCachedUserId', () => {
  it('ログイン中ならuser idを返す', async () => {
    const id = await getCachedUserId(makeSupabase())
    expect(id).toBe('user-1')
  })

  it('ログインしていなければnullを返す', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null })
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null })

    const id = await getCachedUserId(makeSupabase())
    expect(id).toBeNull()
  })
})
