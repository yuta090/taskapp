import React, { useEffect, useReducer } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor, act } from '@testing-library/react'
import { useQueryClient, dehydrate, QueryClient as RQQueryClient, type QueryClient } from '@tanstack/react-query'
import type { PersistedClient } from '@tanstack/react-query-persist-client'
import { QueryProvider } from '@/components/providers/QueryProvider'

type AuthEvent = 'SIGNED_OUT' | 'SIGNED_IN' | 'INITIAL_SESSION' | 'TOKEN_REFRESHED'
type Session = { user: { id: string; email?: string } } | null

let authCallback: (event: AuthEvent, session: Session) => void = () => {}
const mockUnsubscribe = vi.fn()
const mockGetSession = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
      onAuthStateChange: (cb: (event: AuthEvent, session: Session) => void) => {
        authCallback = cb
        return { data: { subscription: { unsubscribe: mockUnsubscribe } } }
      },
    },
  }),
}))

const idbGet = vi.fn()
const idbSet = vi.fn()
const idbDel = vi.fn()
const idbKeys = vi.fn()

vi.mock('idb-keyval', () => ({
  get: (...args: unknown[]) => idbGet(...args),
  set: (...args: unknown[]) => idbSet(...args),
  del: (...args: unknown[]) => idbDel(...args),
  keys: (...args: unknown[]) => idbKeys(...args),
}))

const LEGACY_KEY = 'taskapp-query-cache'
const scopedKey = (uid: string) => `${LEGACY_KEY}:${uid}`

/** Build a realistic PersistedClient payload using the real `dehydrate()`,
 *  instead of hand-rolling the internal dehydrated-query shape. */
function buildPersistedClient(entries: Array<{ queryKey: unknown[]; data: unknown }>): PersistedClient {
  const qc = new RQQueryClient()
  for (const entry of entries) {
    qc.setQueryData(entry.queryKey, entry.data)
  }
  return {
    timestamp: Date.now(),
    buster: '',
    clientState: dehydrate(qc),
  }
}

function sessionFor(uid: string): Session {
  return { user: { id: uid, email: `${uid}@example.com` } }
}

// Reads directly from the query cache instead of using `useQuery` — a real
// `useQuery({ queryKey: [...] })` would attempt its own background fetch
// (there is no queryFn registered here), racing with and overwriting the
// values under test. This probe only observes cache writes made via
// setQueryData / hydrate / the QueryProvider auth listener.
function Probe({ onClient }: { onClient: (qc: QueryClient) => void }) {
  const qc = useQueryClient()
  const [, forceRender] = useReducer((c: number) => c + 1, 0)
  useEffect(() => {
    onClient(qc)
    const unsubscribe = qc.getQueryCache().subscribe(() => forceRender())
    return unsubscribe
  }, [qc, onClient])
  const data = qc.getQueryData<{ id: string } | null>(['currentUser'])
  return <div data-testid="user">{data === null ? 'null' : data ? data.id : 'undefined'}</div>
}

describe('QueryProvider', () => {
  let capturedClient: QueryClient | null = null

  beforeEach(() => {
    vi.clearAllMocks()
    capturedClient = null
    idbGet.mockResolvedValue(undefined)
    idbKeys.mockResolvedValue([])
    mockGetSession.mockResolvedValue({ data: { session: null } })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function renderProvider() {
    return render(
      <QueryProvider>
        <Probe onClient={(qc) => { capturedClient = qc }} />
      </QueryProvider>
    )
  }

  // --- CRITICAL: cross-tenant leak regression -----------------------------
  it('never restores another user\'s data on a cross-load user switch (A closes tab, B signs in)', async () => {
    // A's scoped IDB entry, AND (simulating leftover data from the earlier
    // buggy "single fixed key" design) the legacy unscoped key — both
    // contain A's private data.
    const aData = buildPersistedClient([
      { queryKey: ['userSpaces', 'user-A', false], data: [{ id: 'space-A-secret' }] },
    ])
    idbGet.mockImplementation(async (key: string) => {
      if (key === scopedKey('user-A')) return aData
      if (key === LEGACY_KEY) return aData
      return undefined
    })
    // The browser now has user B's session (A never signed out; B signed in
    // on the same device).
    mockGetSession.mockResolvedValue({ data: { session: sessionFor('user-B') } })

    renderProvider()

    await waitFor(() => {
      expect(capturedClient).not.toBeNull()
    })
    await waitFor(() => {
      expect(capturedClient!.getQueryData(['currentUser'])).not.toBe(undefined)
    })

    // B's identity is what's seeded...
    expect(capturedClient!.getQueryData<{ id: string }>(['currentUser'])?.id).toBe('user-B')
    // ...and A's private data must never have entered B's cache, via either
    // the scoped-for-A key or the legacy unscoped key.
    expect(capturedClient!.getQueryData(['userSpaces', 'user-A', false])).toBe(undefined)
    expect(idbGet).not.toHaveBeenCalledWith(LEGACY_KEY)
  })

  // --- same-user restore must still work (anti "空振り" regression) -------
  it('restores the current user\'s own persisted cache (same-user reload)', async () => {
    const aData = buildPersistedClient([
      { queryKey: ['userSpaces', 'user-A', false], data: [{ id: 'space-A-1' }] },
    ])
    idbGet.mockImplementation(async (key: string) => {
      if (key === scopedKey('user-A')) return aData
      return undefined
    })
    mockGetSession.mockResolvedValue({ data: { session: sessionFor('user-A') } })

    renderProvider()

    await waitFor(() => {
      expect(capturedClient!.getQueryData(['userSpaces', 'user-A', false])).toEqual([
        { id: 'space-A-1' },
      ])
    })
  })

  // --- no session → default-deny -------------------------------------------
  it('restores nothing and never touches IDB when there is no session', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } })

    renderProvider()

    await waitFor(() => {
      expect(mockGetSession).toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(capturedClient!.getQueryData(['currentUser'])).toBe(null)
    })

    // Only the one-time legacy-key purge (`del`) may touch IDB; restoreClient
    // itself must never call `get` while uid is unknown.
    expect(idbGet).not.toHaveBeenCalled()
  })

  // --- PII exclusion ---------------------------------------------------------
  it('never persists the currentUser query to IDB (excluded from dehydrate)', async () => {
    mockGetSession.mockResolvedValue({ data: { session: sessionFor('user-A') } })

    renderProvider()

    await waitFor(() => {
      expect(capturedClient).not.toBeNull()
    })
    await waitFor(() => {
      expect(capturedClient!.getQueryData(['currentUser'])).not.toBe(undefined)
    })

    // Trigger a persist by writing some other query; retry until the
    // subscription (attached after the async restore resolves) is live.
    await waitFor(() => {
      act(() => {
        capturedClient!.setQueryData(['userSpaces', 'user-A', false], [{ id: 's1' }])
      })
      expect(idbSet).toHaveBeenCalled()
    })

    for (const [, persistedClient] of idbSet.mock.calls as Array<[string, PersistedClient]>) {
      const hasCurrentUser = persistedClient.clientState.queries.some(
        (q) => q.queryKey[0] === 'currentUser'
      )
      expect(hasCurrentUser).toBe(false)
    }
  })

  // --- legacy-key migration ---------------------------------------------------
  it('purges the legacy unscoped IDB key on startup', async () => {
    renderProvider()

    await waitFor(() => {
      expect(idbDel).toHaveBeenCalledWith(LEGACY_KEY)
    })
  })

  // --- SIGNED_OUT clears everything (existing regression) --------------------
  it('deletes all taskapp-query-cache* IDB keys on SIGNED_OUT', async () => {
    idbKeys.mockResolvedValue([
      'taskapp-query-cache',
      'taskapp-query-cache:user-A',
      'taskapp-query-cache:user-B',
      'some-other-app-key',
    ])
    mockGetSession.mockResolvedValue({ data: { session: sessionFor('user-A') } })

    renderProvider()
    await waitFor(() => {
      expect(capturedClient).not.toBeNull()
    })

    act(() => {
      authCallback('SIGNED_OUT', null)
    })

    await waitFor(() => {
      expect(idbDel).toHaveBeenCalledWith('taskapp-query-cache:user-A')
    })
    expect(idbDel).toHaveBeenCalledWith('taskapp-query-cache')
    expect(idbDel).toHaveBeenCalledWith('taskapp-query-cache:user-B')
    expect(idbDel).not.toHaveBeenCalledWith('some-other-app-key')
  })

  // --- currentUser stays in sync with auth events -----------------------------
  it('sets currentUser query data to null on SIGNED_OUT', async () => {
    mockGetSession.mockResolvedValue({ data: { session: sessionFor('user-A') } })
    const { getByTestId } = renderProvider()

    await waitFor(() => {
      expect(getByTestId('user').textContent).toBe('user-A')
    })

    act(() => {
      authCallback('SIGNED_OUT', null)
    })

    await waitFor(() => {
      expect(getByTestId('user').textContent).toBe('null')
    })
  })

  it('updates currentUser query data on SIGNED_IN / TOKEN_REFRESHED', async () => {
    mockGetSession.mockResolvedValue({ data: { session: sessionFor('user-A') } })
    const { getByTestId } = renderProvider()

    await waitFor(() => {
      expect(getByTestId('user').textContent).toBe('user-A')
    })

    act(() => {
      authCallback('TOKEN_REFRESHED', sessionFor('user-A'))
    })
    await waitFor(() => {
      expect(getByTestId('user').textContent).toBe('user-A')
    })

    act(() => {
      authCallback('SIGNED_IN', sessionFor('user-B'))
    })
    await waitFor(() => {
      expect(getByTestId('user').textContent).toBe('user-B')
    })
  })
})
