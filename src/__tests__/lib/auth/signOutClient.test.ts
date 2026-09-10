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

const mockSignOut = vi.fn(() => Promise.resolve({ error: null }))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { signOut: mockSignOut },
  }),
}))

const { signOutAndLeave, isSignOutInProgress } = await import('@/lib/auth/signOutClient')

function stubLocation() {
  const replaceSpy = vi.fn()
  Object.defineProperty(window, 'location', {
    value: { ...window.location, replace: replaceSpy },
    writable: true,
  })
  return replaceSpy
}

describe('signOutAndLeave', () => {
  let replaceSpy: ReturnType<typeof stubLocation>

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    replaceSpy = stubLocation()
    mockSignOut.mockResolvedValue({ error: null })
  })

  afterEach(() => {
    localStorage.clear()
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

  it('isSignOutInProgress() is true while sign-out is running', async () => {
    let resolveSignOut: () => void = () => {}
    mockSignOut.mockReturnValue(
      new Promise((resolve) => {
        resolveSignOut = () => resolve({ error: null })
      })
    )

    const promise = signOutAndLeave({ to: '/login' })
    // signOut() を待っている間は true のまま
    await Promise.resolve()
    await Promise.resolve()
    expect(isSignOutInProgress()).toBe(true)

    resolveSignOut()
    await promise
    expect(isSignOutInProgress()).toBe(true)
  })
})
