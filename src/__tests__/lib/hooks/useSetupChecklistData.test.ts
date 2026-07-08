import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useSetupChecklistData } from '@/lib/hooks/useSetupChecklistData'
import { invalidateCachedUser } from '@/lib/supabase/cached-auth'

const ORG_ID = 'org-1'
const SPACE_ID = 'space-1'

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

const mockGetUser = vi.fn()
const mockFrom = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  }),
}))

interface Call {
  method: string
  args: unknown[]
}

/**
 * テーブルごとの応答を差し込める汎用 supabase クエリビルダーのモック。
 * `handlers[table]` はそのテーブルに対して呼ばれた `.eq/.is` 等の履歴を受け取り、
 * `{ data, error }` を返す。builder は select/eq/is を自身で返し続け（チェーン可）、
 * limit/maybeSingle/single が呼ばれた時点で解決する。
 */
function mockSupabaseFrom(handlers: Record<string, (calls: Call[]) => { data: unknown; error: unknown }>) {
  mockFrom.mockImplementation((table: string) => {
    const calls: Call[] = []
    const resolve = () => Promise.resolve(handlers[table]?.(calls) ?? { data: null, error: null })

    const builder = {
      select: (...args: unknown[]) => {
        calls.push({ method: 'select', args })
        return builder
      },
      eq: (...args: unknown[]) => {
        calls.push({ method: 'eq', args })
        return builder
      },
      is: (...args: unknown[]) => {
        calls.push({ method: 'is', args })
        return builder
      },
      limit: (...args: unknown[]) => {
        calls.push({ method: 'limit', args })
        return resolve()
      },
      maybeSingle: () => resolve(),
      single: () => resolve(),
      // Real supabase-js query builders are thenable even without a terminal
      // call like .limit()/.single() — `await supabase.from(...).select().eq()`
      // resolves directly. Mirror that here so queries without an explicit
      // terminal call (org_memberships/invites) actually resolve when awaited.
      then: (onFulfilled?: (v: { data: unknown; error: unknown }) => unknown, onRejected?: (e: unknown) => unknown) =>
        resolve().then(onFulfilled, onRejected),
    }
    return builder
  })
}

function hasEqCall(calls: Call[], column: string, value: unknown): boolean {
  return calls.some((c) => c.method === 'eq' && c.args[0] === column && c.args[1] === value)
}

describe('useSetupChecklistData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    invalidateCachedUser()
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
  })

  it('returns all-false defaults with loading=false when there is no logged-in user', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null })
    mockSupabaseFrom({})

    const { result } = renderHook(() => useSetupChecklistData(ORG_ID, SPACE_ID), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.hasNonSampleTask).toBe(false)
    expect(result.current.hasTeamInvite).toBe(false)
    expect(result.current.hasClientInvite).toBe(false)
    expect(result.current.hasPublishedTask).toBe(false)
    expect(result.current.hasPreviewedPortal).toBe(false)
    expect(result.current.currentUserRole).toBeNull()
  })

  it('reads currentUserRole from space_memberships', async () => {
    mockSupabaseFrom({
      space_memberships: () => ({ data: { role: 'admin' }, error: null }),
      tasks: () => ({ data: [], error: null }),
      org_memberships: () => ({ data: [], error: null }),
      invites: () => ({ data: [], error: null }),
      profiles: () => ({ data: { onboarding_flags: {} }, error: null }),
    })

    const { result } = renderHook(() => useSetupChecklistData(ORG_ID, SPACE_ID), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.currentUserRole).toBe('admin')
  })

  it('sets hasNonSampleTask true when a non-sample task exists in the org', async () => {
    mockSupabaseFrom({
      space_memberships: () => ({ data: null, error: null }),
      tasks: () => ({ data: [{ id: 't1' }], error: null }),
      org_memberships: () => ({ data: [], error: null }),
      invites: () => ({ data: [], error: null }),
      profiles: () => ({ data: { onboarding_flags: {} }, error: null }),
    })

    const { result } = renderHook(() => useSetupChecklistData(ORG_ID, SPACE_ID), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.hasNonSampleTask).toBe(true)
  })

  it('falls back to an is_sample-less existence check when the is_sample column errors (unmigrated env)', async () => {
    mockSupabaseFrom({
      space_memberships: () => ({ data: null, error: null }),
      tasks: (calls) => {
        if (hasEqCall(calls, 'is_sample', false)) {
          return { data: null, error: { message: 'column "is_sample" does not exist' } }
        }
        return { data: [{ id: 't1' }], error: null }
      },
      org_memberships: () => ({ data: [], error: null }),
      invites: () => ({ data: [], error: null }),
      profiles: () => ({ data: { onboarding_flags: {} }, error: null }),
    })

    const { result } = renderHook(() => useSetupChecklistData(ORG_ID, SPACE_ID), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.hasNonSampleTask).toBe(true)
    expect(result.current.hasPublishedTask).toBe(true)
  })

  it('sets hasPublishedTask true only for client_scope=deliverable tasks, independent of hasNonSampleTask', async () => {
    mockSupabaseFrom({
      space_memberships: () => ({ data: null, error: null }),
      tasks: (calls) => {
        if (hasEqCall(calls, 'client_scope', 'deliverable')) {
          return { data: [], error: null }
        }
        return { data: [{ id: 't1' }], error: null }
      },
      org_memberships: () => ({ data: [], error: null }),
      invites: () => ({ data: [], error: null }),
      profiles: () => ({ data: { onboarding_flags: {} }, error: null }),
    })

    const { result } = renderHook(() => useSetupChecklistData(ORG_ID, SPACE_ID), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.hasNonSampleTask).toBe(true)
    expect(result.current.hasPublishedTask).toBe(false)
  })

  it('sets hasTeamInvite true when there are 2+ non-client org memberships', async () => {
    mockSupabaseFrom({
      space_memberships: () => ({ data: null, error: null }),
      tasks: () => ({ data: [], error: null }),
      org_memberships: () => ({
        data: [{ role: 'owner' }, { role: 'member' }, { role: 'client' }],
        error: null,
      }),
      invites: () => ({ data: [], error: null }),
      profiles: () => ({ data: { onboarding_flags: {} }, error: null }),
    })

    const { result } = renderHook(() => useSetupChecklistData(ORG_ID, SPACE_ID), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.hasTeamInvite).toBe(true)
    expect(result.current.hasClientInvite).toBe(true)
  })

  it('sets hasTeamInvite true via a pending internal invite when membership count is below 2', async () => {
    mockSupabaseFrom({
      space_memberships: () => ({ data: null, error: null }),
      tasks: () => ({ data: [], error: null }),
      org_memberships: () => ({ data: [{ role: 'owner' }], error: null }),
      invites: () => ({ data: [{ role: 'member' }], error: null }),
      profiles: () => ({ data: { onboarding_flags: {} }, error: null }),
    })

    const { result } = renderHook(() => useSetupChecklistData(ORG_ID, SPACE_ID), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.hasTeamInvite).toBe(true)
  })

  it('sets hasClientInvite true via a pending client invite when no client member exists yet', async () => {
    mockSupabaseFrom({
      space_memberships: () => ({ data: null, error: null }),
      tasks: () => ({ data: [], error: null }),
      org_memberships: () => ({ data: [{ role: 'owner' }], error: null }),
      invites: () => ({ data: [{ role: 'client' }], error: null }),
      profiles: () => ({ data: { onboarding_flags: {} }, error: null }),
    })

    const { result } = renderHook(() => useSetupChecklistData(ORG_ID, SPACE_ID), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.hasClientInvite).toBe(true)
  })

  it('reads hasPreviewedPortal from profiles.onboarding_flags.portal_preview_seen', async () => {
    mockSupabaseFrom({
      space_memberships: () => ({ data: null, error: null }),
      tasks: () => ({ data: [], error: null }),
      org_memberships: () => ({ data: [], error: null }),
      invites: () => ({ data: [], error: null }),
      profiles: () => ({ data: { onboarding_flags: { portal_preview_seen: true } }, error: null }),
    })

    const { result } = renderHook(() => useSetupChecklistData(ORG_ID, SPACE_ID), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.hasPreviewedPortal).toBe(true)
  })
})
