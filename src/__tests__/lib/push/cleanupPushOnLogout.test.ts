import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanupPushOnLogout } from '@/lib/push/cleanupPushOnLogout'

/**
 * cleanupPushOnLogout() runs right before signOut() so the Web Push
 * subscription tied to the departing user is released before another user
 * can log into the same shared browser (see /api/push/subscribe for the
 * server-side half of this fix).
 *
 * It must be entirely best-effort: any failure (unsupported browser, no
 * subscription, network error) must be swallowed, never thrown, since
 * logout must never be blocked by push cleanup.
 */

describe('cleanupPushOnLogout', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does nothing when the browser has no serviceWorker support', async () => {
    vi.stubGlobal('navigator', {})

    await expect(cleanupPushOnLogout()).resolves.toBeUndefined()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does nothing when there is no existing push subscription', async () => {
    const register = vi.fn(() =>
      Promise.resolve({ pushManager: { getSubscription: () => Promise.resolve(null) } })
    )
    vi.stubGlobal('navigator', { serviceWorker: { register } })

    await cleanupPushOnLogout()

    expect(fetch).not.toHaveBeenCalled()
  })

  it('unsubscribes locally and calls /api/push/unsubscribe when a subscription exists', async () => {
    const unsubscribe = vi.fn(() => Promise.resolve(true))
    const subscription = { endpoint: 'https://push.example/abc', unsubscribe }
    const register = vi.fn(() =>
      Promise.resolve({ pushManager: { getSubscription: () => Promise.resolve(subscription) } })
    )
    vi.stubGlobal('navigator', { serviceWorker: { register } })

    await cleanupPushOnLogout()

    expect(fetch).toHaveBeenCalledWith(
      '/api/push/unsubscribe',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ endpoint: 'https://push.example/abc' }),
      })
    )
    expect(unsubscribe).toHaveBeenCalled()
  })

  it('swallows errors from the server call and still unsubscribes locally', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network error'))))
    const unsubscribe = vi.fn(() => Promise.resolve(true))
    const subscription = { endpoint: 'https://push.example/abc', unsubscribe }
    const register = vi.fn(() =>
      Promise.resolve({ pushManager: { getSubscription: () => Promise.resolve(subscription) } })
    )
    vi.stubGlobal('navigator', { serviceWorker: { register } })

    await expect(cleanupPushOnLogout()).resolves.toBeUndefined()
    expect(unsubscribe).toHaveBeenCalled()
  })

  it('swallows errors from the local unsubscribe call', async () => {
    const unsubscribe = vi.fn(() => Promise.reject(new Error('unsubscribe failed')))
    const subscription = { endpoint: 'https://push.example/abc', unsubscribe }
    const register = vi.fn(() =>
      Promise.resolve({ pushManager: { getSubscription: () => Promise.resolve(subscription) } })
    )
    vi.stubGlobal('navigator', { serviceWorker: { register } })

    await expect(cleanupPushOnLogout()).resolves.toBeUndefined()
  })

  it('swallows errors thrown while registering the service worker', async () => {
    const register = vi.fn(() => Promise.reject(new Error('register failed')))
    vi.stubGlobal('navigator', { serviceWorker: { register } })

    await expect(cleanupPushOnLogout()).resolves.toBeUndefined()
  })
})
