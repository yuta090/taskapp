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
const updateCalls: Array<Record<string, unknown>> = []
let updateResponse: { error: null | { message: string } }

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
      update: vi.fn((payload: Record<string, unknown>) => {
        updateCalls.push(payload)
        return { eq: vi.fn(() => Promise.resolve(updateResponse)) }
      }),
    })),
  }),
}))

const { markPortalPreviewSeen } = await import('@/lib/portal/markPortalPreviewSeen')

describe('markPortalPreviewSeen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    updateCalls.length = 0
    getUserResponse = { data: { user: mockUser }, error: null }
    selectResponse = { data: { onboarding_flags: { portal_walkthrough: true } }, error: null }
    updateResponse = { error: null }
  })

  it('merges portal_preview_seen=true into existing onboarding_flags without dropping other flags', async () => {
    await markPortalPreviewSeen()

    expect(updateCalls).toEqual([
      { onboarding_flags: { portal_walkthrough: true, portal_preview_seen: true } },
    ])
  })

  it('does nothing when there is no authenticated user', async () => {
    getUserResponse = { data: { user: null }, error: null }

    await markPortalPreviewSeen()

    expect(updateCalls).toEqual([])
  })

  it('swallows errors (best-effort persistence, never throws)', async () => {
    updateResponse = { error: { message: 'db down' } }

    await expect(markPortalPreviewSeen()).resolves.toBeUndefined()
  })
})
