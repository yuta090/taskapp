import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * `portal_preview_seen` — records that an internal user has viewed the
 * client-facing preview at least once. Persisted the same way as
 * useOnboardingFlag's markDone: merge into profiles.onboarding_flags rather
 * than overwrite, so it never clobbers unrelated flags (e.g. portal_walkthrough).
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
      // upsert (not update) — the profiles row may not exist yet if the
      // on_auth_user_created trigger hasn't run.
      upsert: vi.fn((payload: Record<string, unknown>, options: Record<string, unknown>) => {
        upsertCalls.push([payload, options])
        return Promise.resolve(upsertResponse)
      }),
    })),
  }),
}))

const { markPortalPreviewSeen } = await import('@/lib/portal/markPortalPreviewSeen')

describe('markPortalPreviewSeen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    upsertCalls.length = 0
    getUserResponse = { data: { user: mockUser }, error: null }
    selectResponse = { data: { onboarding_flags: { portal_walkthrough: true } }, error: null }
    upsertResponse = { error: null }
  })

  it('merges portal_preview_seen=true into existing onboarding_flags without dropping other flags', async () => {
    await markPortalPreviewSeen()

    expect(upsertCalls).toEqual([
      [
        { id: mockUser.id, onboarding_flags: { portal_walkthrough: true, portal_preview_seen: true } },
        { onConflict: 'id' },
      ],
    ])
  })

  it('does nothing when there is no authenticated user', async () => {
    getUserResponse = { data: { user: null }, error: null }

    await markPortalPreviewSeen()

    expect(upsertCalls).toEqual([])
  })

  it('swallows errors (best-effort persistence, never throws)', async () => {
    upsertResponse = { error: { message: 'db down' } }

    await expect(markPortalPreviewSeen()).resolves.toBeUndefined()
  })
})
