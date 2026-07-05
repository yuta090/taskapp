import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { usePushNotifications } from '@/lib/hooks/usePushNotifications'

const mockFrom = vi.fn()
const mockUpsert = vi.fn(() => Promise.resolve({ error: null }))
const mockDeleteEq = vi.fn(() => Promise.resolve({ error: null }))
const mockDelete = vi.fn(() => ({ eq: mockDeleteEq }))
const mockGetUser = vi.fn(() =>
  Promise.resolve({ data: { user: { id: 'user-1' } }, error: null })
)

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  }),
}))

process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = 'aGVsbG8'

function makeSubscription(overrides: Partial<{ endpoint: string }> = {}) {
  return {
    endpoint: overrides.endpoint ?? 'https://push.example/abc',
    toJSON: () => ({
      endpoint: overrides.endpoint ?? 'https://push.example/abc',
      keys: { p256dh: 'p256dh-value', auth: 'auth-value' },
    }),
    unsubscribe: vi.fn(() => Promise.resolve(true)),
  }
}

function stubSupportedEnvironment({
  existingSubscription = null,
  subscribeResult,
}: {
  existingSubscription?: ReturnType<typeof makeSubscription> | null
  subscribeResult?: ReturnType<typeof makeSubscription>
} = {}) {
  const pushManager = {
    getSubscription: vi.fn(() => Promise.resolve(existingSubscription)),
    subscribe: vi.fn(() => Promise.resolve(subscribeResult ?? makeSubscription())),
  }
  const registration = { pushManager }
  const register = vi.fn(() => Promise.resolve(registration))

  vi.stubGlobal('navigator', {
    serviceWorker: { register },
    userAgent: 'test-agent',
  })
  vi.stubGlobal('PushManager', function () {})
  vi.stubGlobal(
    'Notification',
    Object.assign(
      vi.fn(),
      { permission: 'default', requestPermission: vi.fn(() => Promise.resolve('granted')) }
    )
  )

  return { register, pushManager }
}

describe('usePushNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFrom.mockReturnValue({ upsert: mockUpsert, delete: mockDelete })
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reports isSupported=false when the browser lacks Push API support', async () => {
    vi.stubGlobal('navigator', {})
    const { result } = renderHook(() => usePushNotifications())

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.isSupported).toBe(false)
  })

  it('detects an existing subscription on mount', async () => {
    stubSupportedEnvironment({ existingSubscription: makeSubscription() })
    const { result } = renderHook(() => usePushNotifications())

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.isSupported).toBe(true)
    expect(result.current.isSubscribed).toBe(true)
  })

  it('reports isSubscribed=false when there is no existing subscription', async () => {
    stubSupportedEnvironment({ existingSubscription: null })
    const { result } = renderHook(() => usePushNotifications())

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.isSubscribed).toBe(false)
  })

  // Regression: enabling used to upsert push_subscriptions directly from the
  // browser (onConflict: 'endpoint'). Since endpoint is globally UNIQUE and
  // RLS only allows updating rows the caller owns, a second user enabling
  // push on the same shared browser could never take over the row. Enabling
  // now goes through the service_role-backed /api/push/subscribe route,
  // which transfers ownership instead.
  it('enable() subscribes and registers via /api/push/subscribe', async () => {
    stubSupportedEnvironment({ existingSubscription: null })
    const { result } = renderHook(() => usePushNotifications())
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.enable()
    })

    expect(result.current.isSubscribed).toBe(true)
    expect(mockFrom).not.toHaveBeenCalledWith('push_subscriptions')
    expect(mockUpsert).not.toHaveBeenCalled()
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/push/subscribe',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          endpoint: 'https://push.example/abc',
          keys: { p256dh: 'p256dh-value', auth: 'auth-value' },
          userAgent: 'test-agent',
        }),
      })
    )
  })

  it('enable() sets an error and does not subscribe when permission is denied', async () => {
    const { pushManager } = stubSupportedEnvironment({ existingSubscription: null })
    vi.stubGlobal(
      'Notification',
      Object.assign(vi.fn(), {
        permission: 'default',
        requestPermission: vi.fn(() => Promise.resolve('denied')),
      })
    )

    const { result } = renderHook(() => usePushNotifications())
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.enable()
    })

    expect(result.current.isSubscribed).toBe(false)
    expect(result.current.error).toBeTruthy()
    expect(pushManager.subscribe).not.toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('enable() sets an error and does not mark as subscribed when the server rejects the subscription', async () => {
    stubSupportedEnvironment({ existingSubscription: null })
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false })

    const { result } = renderHook(() => usePushNotifications())
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.enable()
    })

    expect(result.current.isSubscribed).toBe(false)
    expect(result.current.error).toBeTruthy()
  })

  it('disable() unsubscribes and deletes the subscription by endpoint', async () => {
    const subscription = makeSubscription()
    stubSupportedEnvironment({ existingSubscription: subscription })
    const { result } = renderHook(() => usePushNotifications())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.isSubscribed).toBe(true)

    await act(async () => {
      await result.current.disable()
    })

    expect(subscription.unsubscribe).toHaveBeenCalled()
    expect(mockFrom).toHaveBeenCalledWith('push_subscriptions')
    expect(mockDelete).toHaveBeenCalled()
    expect(mockDeleteEq).toHaveBeenCalledWith('endpoint', 'https://push.example/abc')
    expect(result.current.isSubscribed).toBe(false)
  })
})
