import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * `no_client` — 「クライアントなしで進める」を選んだことを記録する。
 * useOnboardingFlag の markDone / markPortalPreviewSeen と同じく
 * profiles.onboarding_flags にマージ保存し、他のフラグを消さない。
 */

const mockUser = { id: 'internal-user-1' }

let getUserResponse: { data: { user: typeof mockUser | null }; error: null | { message: string } }
let selectResponse: { data: { onboarding_flags: Record<string, boolean> } | null; error: null | { message: string } }
const upsertCalls: Array<[Record<string, unknown>, Record<string, unknown>]> = []
let upsertResponse: { error: null | { message: string } }

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser: vi.fn(() => Promise.resolve(getUserResponse)),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve(selectResponse)),
        })),
      })),
      upsert: vi.fn((payload: Record<string, unknown>, options: Record<string, unknown>) => {
        upsertCalls.push([payload, options])
        return Promise.resolve(upsertResponse)
      }),
    })),
  }),
}))

const { markNoClient } = await import('@/lib/onboarding/markNoClient')

describe('markNoClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    upsertCalls.length = 0
    getUserResponse = { data: { user: mockUser }, error: null }
    selectResponse = { data: { onboarding_flags: { portal_preview_seen: true } }, error: null }
    upsertResponse = { error: null }
  })

  it('merges no_client=true into existing onboarding_flags without dropping other flags', async () => {
    await markNoClient()

    expect(upsertCalls).toEqual([
      [
        { id: mockUser.id, onboarding_flags: { portal_preview_seen: true, no_client: true } },
        { onConflict: 'id' },
      ],
    ])
  })

  it('does nothing when there is no authenticated user', async () => {
    getUserResponse = { data: { user: null }, error: null }

    await markNoClient()

    expect(upsertCalls).toEqual([])
  })

  it('swallows errors (best-effort persistence, never throws)', async () => {
    upsertResponse = { error: { message: 'db down' } }

    await expect(markNoClient()).resolves.toBeUndefined()
  })
})
