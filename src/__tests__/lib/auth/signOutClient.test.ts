import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * signOutAndLeave() — ログアウト→サインイン識別変更後もクライアント状態(query cache /
 * ActiveOrgProvider / module-level state)が残る問題の修正。
 *
 * 「ログアウト＝必ずフルページ遷移」に統一する唯一の入口。呼び出し順序が壊れると:
 * - cleanupPushOnLogout を signOut より後にすると /api/push/unsubscribe がセッション切れで失敗する
 * - location.replace を待たずに他の処理が失敗すると、ユーザーが宙に浮いた画面に取り残される
 */

const mockCleanupPushOnLogout = vi.fn(() => Promise.resolve())
vi.mock('@/lib/push/cleanupPushOnLogout', () => ({
  cleanupPushOnLogout: mockCleanupPushOnLogout,
}))

const mockSignOut = vi.fn<() => Promise<{ error: Error | null }>>(() => Promise.resolve({ error: null }))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { signOut: mockSignOut },
  }),
}))

const mockClearQueryCache = vi.fn(() => Promise.resolve())
vi.mock('@/lib/query/persistedCache', () => ({
  clearQueryCache: () => mockClearQueryCache(),
}))

const { signOutAndLeave } = await import('@/lib/auth/signOutClient')

function stubLocation(overrides: Partial<Location> = {}) {
  const replaceSpy = vi.fn()
  const reloadSpy = vi.fn()
  Object.defineProperty(window, 'location', {
    value: { ...window.location, replace: replaceSpy, reload: reloadSpy, ...overrides },
    writable: true,
  })
  return { replaceSpy, reloadSpy }
}

function clearAllCookies() {
  document.cookie.split(';').forEach((pair) => {
    const name = pair.split('=')[0]?.trim()
    if (name) document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`
  })
}

function cookieNames(): string[] {
  return document.cookie
    .split(';')
    .map((pair) => pair.split('=')[0]?.trim())
    .filter((name): name is string => !!name)
}

describe('signOutAndLeave', () => {
  let replaceSpy: ReturnType<typeof stubLocation>['replaceSpy']
  let reloadSpy: ReturnType<typeof stubLocation>['reloadSpy']

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    clearAllCookies()
    ;({ replaceSpy, reloadSpy } = stubLocation())
    mockSignOut.mockResolvedValue({ error: null })
    mockClearQueryCache.mockImplementation(() => Promise.resolve())
  })

  afterEach(() => {
    localStorage.clear()
    clearAllCookies()
  })

  it('runs cleanupPushOnLogout → auth.signOut → location.replace(to) in order', async () => {
    await signOutAndLeave({ to: '/login' })

    expect(mockCleanupPushOnLogout).toHaveBeenCalled()
    expect(mockSignOut).toHaveBeenCalled()
    expect(replaceSpy).toHaveBeenCalledWith('/login')

    const cleanupOrder = mockCleanupPushOnLogout.mock.invocationCallOrder[0]
    const signOutOrder = mockSignOut.mock.invocationCallOrder[0]
    const replaceOrder = replaceSpy.mock.invocationCallOrder[0]
    expect(cleanupOrder).toBeLessThan(signOutOrder)
    expect(signOutOrder).toBeLessThan(replaceOrder)
  })

  it('defaults to /login when no destination is given', async () => {
    await signOutAndLeave()
    expect(replaceSpy).toHaveBeenCalledWith('/login')
  })

  it('skips push cleanup when pushCleanup is false', async () => {
    await signOutAndLeave({ to: '/admin/login', pushCleanup: false })

    expect(mockCleanupPushOnLogout).not.toHaveBeenCalled()
    expect(mockSignOut).toHaveBeenCalled()
    expect(replaceSpy).toHaveBeenCalledWith('/admin/login')
  })

  it('defaults pushCleanup to true (the caller is still logged in at click time in most call sites)', async () => {
    await signOutAndLeave({ to: '/login' })
    expect(mockCleanupPushOnLogout).toHaveBeenCalled()
  })

  it('still navigates away even if auth.signOut() rejects', async () => {
    mockSignOut.mockRejectedValue(new Error('network down'))

    await expect(signOutAndLeave({ to: '/login' })).resolves.toBeUndefined()
    expect(replaceSpy).toHaveBeenCalledWith('/login')
  })

  it('still navigates away even if cleanupPushOnLogout rejects', async () => {
    mockCleanupPushOnLogout.mockRejectedValue(new Error('push cleanup failed'))

    await expect(signOutAndLeave({ to: '/login' })).resolves.toBeUndefined()
    expect(mockSignOut).toHaveBeenCalled()
    expect(replaceSpy).toHaveBeenCalledWith('/login')
  })

  it('removes only taskapp_draft_* keys from localStorage, leaving unrelated keys intact', async () => {
    localStorage.setItem('taskapp_draft_task-create', JSON.stringify({ title: '下書き' }))
    localStorage.setItem('taskapp_draft_meeting-create-space1', JSON.stringify({ note: 'x' }))
    localStorage.setItem('taskapp:lastPath', '/org-1/inbox')
    localStorage.setItem('taskapp:sidebar:portal:collapsed', 'true')

    await signOutAndLeave({ to: '/login' })

    expect(localStorage.getItem('taskapp_draft_task-create')).toBeNull()
    expect(localStorage.getItem('taskapp_draft_meeting-create-space1')).toBeNull()
    expect(localStorage.getItem('taskapp:lastPath')).toBe('/org-1/inbox')
    expect(localStorage.getItem('taskapp:sidebar:portal:collapsed')).toBe('true')
  })

  // --- 失敗時の Cookie 手動失効（共有PCでの「ログアウトしたのにまだログイン中」対策） -----------
  // auth-js の signOut() はネットワーク断・5xx で throw せず { error } を返すだけで、この場合
  // Cookie を消さない。ここで検知して sb-*-auth-token を手動で失効させないと、次に開いた人が
  // proxy にまだ有効なセッションとして通されてしまう。
  describe('signOut() 失敗時の Cookie 失効', () => {
    it('{ error } が返ったら sb-*-auth-token 系の Cookie を失効させ、それでも離脱する', async () => {
      document.cookie = 'sb-abcxyz-auth-token=payload; path=/'
      document.cookie = 'sb-abcxyz-auth-token.0=chunk0; path=/'
      document.cookie = 'sb-abcxyz-auth-token.1=chunk1; path=/'
      document.cookie = 'other-app-cookie=keep-me; path=/'
      mockSignOut.mockResolvedValue({ error: new Error('network down') })

      await signOutAndLeave({ to: '/login' })

      const remaining = cookieNames()
      expect(remaining).not.toContain('sb-abcxyz-auth-token')
      expect(remaining).not.toContain('sb-abcxyz-auth-token.0')
      expect(remaining).not.toContain('sb-abcxyz-auth-token.1')
      expect(remaining).toContain('other-app-cookie')
      expect(replaceSpy).toHaveBeenCalledWith('/login')
    })

    it('signOut() が例外を投げた場合も Cookie を失効させる', async () => {
      document.cookie = 'sb-abcxyz-auth-token=payload; path=/'
      mockSignOut.mockRejectedValue(new Error('offline'))

      await signOutAndLeave({ to: '/login' })

      expect(cookieNames()).not.toContain('sb-abcxyz-auth-token')
      expect(replaceSpy).toHaveBeenCalledWith('/login')
    })

    it('signOut() が成功したときは Cookie を手動で触らない（SDK側の削除に任せる）', async () => {
      document.cookie = 'sb-abcxyz-auth-token=payload; path=/'
      mockSignOut.mockResolvedValue({ error: null })

      await signOutAndLeave({ to: '/login' })

      // モック環境では実際のSDKのCookie削除は起きないので、成功時にここで消していなければ残る
      expect(cookieNames()).toContain('sb-abcxyz-auth-token')
    })
  })

  // --- #hash だけが違う同一URLへの遷移は reload() に倒す ---------------------------------------
  // location.replace('現在のURL#hash') はブラウザ上ではページを実際には読み込み直さない
  // in-page navigation になるため、hardResetIfNeeded の安全弁が効かないまま固まってしまう。
  describe('同一ページ（#hash違いのみ）への遷移は reload() する', () => {
    it('to が現在の URL と完全一致（hashなし）なら reload() する', async () => {
      ;({ replaceSpy, reloadSpy } = stubLocation({ href: 'http://localhost:3000/portal/tok-1' } as Partial<Location>))

      await signOutAndLeave({ to: 'http://localhost:3000/portal/tok-1', pushCleanup: false })

      expect(reloadSpy).toHaveBeenCalledTimes(1)
      expect(replaceSpy).not.toHaveBeenCalled()
    })

    it('to が現在の URL + #hash なら（hash違いのみ）reload() する', async () => {
      ;({ replaceSpy, reloadSpy } = stubLocation({ href: 'http://localhost:3000/invite/tok-1' } as Partial<Location>))

      await signOutAndLeave({ to: 'http://localhost:3000/invite/tok-1#section', pushCleanup: false })

      expect(reloadSpy).toHaveBeenCalledTimes(1)
      expect(replaceSpy).not.toHaveBeenCalled()
    })

    it('to が別ページなら通常どおり replace() する（reload() しない）', async () => {
      ;({ replaceSpy, reloadSpy } = stubLocation({ href: 'http://localhost:3000/portal/tok-1' } as Partial<Location>))

      await signOutAndLeave({ to: '/login', pushCleanup: false })

      expect(replaceSpy).toHaveBeenCalledWith('/login')
      expect(reloadSpy).not.toHaveBeenCalled()
    })
  })

  // --- IDB のクエリキャッシュは signOut() の成否に関わらず必ず消す ------------------------------
  // auth-js の signOut() はネットワーク断・5xx で throw せず { error } を返すだけで、この場合
  // SIGNED_OUT イベントが発火しないため QueryProvider 側の削除に頼れない。ここで必ず消す。
  describe('clearQueryCache() を離脱前に必ず待つ', () => {
    it('signOut() 成功時も、location.replace の前に clearQueryCache を待つ', async () => {
      const callOrder: string[] = []
      mockClearQueryCache.mockImplementation(() => {
        callOrder.push('clearQueryCache')
        return Promise.resolve()
      })
      replaceSpy.mockImplementation(() => { callOrder.push('replace') })

      await signOutAndLeave({ to: '/login' })

      expect(mockClearQueryCache).toHaveBeenCalled()
      expect(replaceSpy).toHaveBeenCalledWith('/login')
      expect(callOrder).toEqual(['clearQueryCache', 'replace'])
    })

    it('signOut() が { error } を返しても、離脱前に clearQueryCache を待つ', async () => {
      mockSignOut.mockResolvedValue({ error: new Error('network down') })
      const callOrder: string[] = []
      mockClearQueryCache.mockImplementation(() => {
        callOrder.push('clearQueryCache')
        return Promise.resolve()
      })
      replaceSpy.mockImplementation(() => { callOrder.push('replace') })

      await signOutAndLeave({ to: '/login' })

      expect(mockClearQueryCache).toHaveBeenCalled()
      expect(callOrder).toEqual(['clearQueryCache', 'replace'])
    })

    it('signOut() が例外を投げても、離脱前に clearQueryCache を待つ', async () => {
      mockSignOut.mockRejectedValue(new Error('offline'))
      const callOrder: string[] = []
      mockClearQueryCache.mockImplementation(() => {
        callOrder.push('clearQueryCache')
        return Promise.resolve()
      })
      replaceSpy.mockImplementation(() => { callOrder.push('replace') })

      await signOutAndLeave({ to: '/login' })

      expect(mockClearQueryCache).toHaveBeenCalled()
      expect(callOrder).toEqual(['clearQueryCache', 'replace'])
    })

    it('clearQueryCache が解決しなくても、タイムアウトで打ち切って離脱する', async () => {
      vi.useFakeTimers()
      try {
        // 二度と解決しない Promise（IDB が詰まって固まったケースを模す）
        mockClearQueryCache.mockImplementation(() => new Promise(() => {}))

        const promise = signOutAndLeave({ to: '/login' })

        // まだタイムアウト前は離脱していない
        await vi.advanceTimersByTimeAsync(500)
        expect(replaceSpy).not.toHaveBeenCalled()

        // タイムアウト経過後は打ち切って離脱する
        await vi.advanceTimersByTimeAsync(600)
        await promise

        expect(replaceSpy).toHaveBeenCalledWith('/login')
      } finally {
        vi.useRealTimers()
      }
    })
  })

  // --- isSignOutInProgress() ---------------------------------------------------------------
  describe('isSignOutInProgress()', () => {
    it('実行前は false、auth.signOut() を呼んでいる最中（解決前）は true になる（モジュール新規インスタンスで検証）', async () => {
      vi.resetModules()
      const fresh = await import('@/lib/auth/signOutClient')

      expect(fresh.isSignOutInProgress()).toBe(false)

      let observedDuringSignOut: boolean | null = null
      mockSignOut.mockImplementation(() => {
        // signOut() が呼ばれた時点（=まだ解決していない）で旗が立っていることを、
        // モック実装の内側で直接観測する
        observedDuringSignOut = fresh.isSignOutInProgress()
        return Promise.resolve({ error: null })
      })

      await fresh.signOutAndLeave({ to: '/login' })

      expect(observedDuringSignOut).toBe(true)
    })

    it('10秒経過すると失効する（QueryProvider の hardResetIfNeeded が永久にブロックされないための安全弁）', async () => {
      vi.resetModules()
      const fresh = await import('@/lib/auth/signOutClient')
      const dateSpy = vi.spyOn(Date, 'now')
      try {
        dateSpy.mockReturnValue(1_000_000)
        await fresh.signOutAndLeave({ to: '/login' })
        expect(fresh.isSignOutInProgress()).toBe(true)

        dateSpy.mockReturnValue(1_000_000 + 9_999)
        expect(fresh.isSignOutInProgress()).toBe(true)

        dateSpy.mockReturnValue(1_000_000 + 10_000)
        expect(fresh.isSignOutInProgress()).toBe(false)
      } finally {
        dateSpy.mockRestore()
      }
    })
  })
})
