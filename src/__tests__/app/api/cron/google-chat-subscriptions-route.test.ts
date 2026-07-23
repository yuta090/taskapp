import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/cron/google-chat-subscriptions — pg_cron(10分間隔)からの Bearer CRON_SECRET
 * 呼び出し専用。購読ライフサイクルの自己修復ループ(reconcileGoogleChatSubscriptions)を1回まわす。
 * connector-dispatch / due-reminder-planner と同一の認証パターン。
 */

const reconcileMock = vi.fn()
vi.mock('@/lib/channels/google-chat/subscriptionReconciler', () => ({
  reconcileGoogleChatSubscriptions: (...args: unknown[]) => reconcileMock(...args),
}))

vi.mock('@/lib/channels/store', () => ({
  listActiveClaimedGroupsWithoutActiveSubscription: vi.fn(),
  createEventSubscription: vi.fn(),
  setEventSubscriptionResource: vi.fn(),
  listSubscriptionsToRenew: vi.fn(),
  listOrphanedActiveSubscriptions: vi.fn(),
  markSubscriptionStatus: vi.fn(),
}))

vi.mock('@/lib/channels/google-chat/client', () => ({
  createChatSubscription: vi.fn(),
  renewChatSubscription: vi.fn(),
  deleteChatSubscription: vi.fn(),
}))

const { POST } = await import('@/app/api/cron/google-chat-subscriptions/route')

function callPost(headers: Record<string, string> = {}) {
  const request = new NextRequest(new URL('/api/cron/google-chat-subscriptions', 'http://localhost:3000'), {
    method: 'POST',
    headers,
  })
  return POST(request)
}

describe('POST /api/cron/google-chat-subscriptions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'test-cron-secret'
    reconcileMock.mockResolvedValue({ created: 0, renewed: 0, broken: 0, deleted: 0 })
  })

  it('returns 500 when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET
    const response = await callPost({ authorization: 'Bearer anything' })
    expect(response.status).toBe(500)
    expect(reconcileMock).not.toHaveBeenCalled()
  })

  it('returns 401 when no Authorization header is present', async () => {
    const response = await callPost()
    expect(response.status).toBe(401)
    expect(reconcileMock).not.toHaveBeenCalled()
  })

  it('returns 401 when the token does not match CRON_SECRET', async () => {
    const response = await callPost({ authorization: 'Bearer wrong-token' })
    expect(response.status).toBe(401)
    expect(reconcileMock).not.toHaveBeenCalled()
  })

  it('returns 200 with the reconcile summary on a valid secret', async () => {
    reconcileMock.mockResolvedValue({ created: 2, renewed: 1, broken: 0, deleted: 1 })
    const response = await callPost({ authorization: 'Bearer test-cron-secret' })
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data).toEqual({ created: 2, renewed: 1, broken: 0, deleted: 1 })
    expect(reconcileMock).toHaveBeenCalledTimes(1)
  })
})
