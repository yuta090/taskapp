import React, { useEffect, useReducer } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor, act } from '@testing-library/react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { QueryProvider } from '@/components/providers/QueryProvider'

type AuthEvent = 'SIGNED_OUT' | 'SIGNED_IN' | 'INITIAL_SESSION' | 'TOKEN_REFRESHED'
type Session = { user: { id: string } } | null

let authCallback: (event: AuthEvent, session: Session) => void = () => {}
const mockUnsubscribe = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
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

const IDB_KEY = 'taskapp-query-cache'

// Reads directly from the query cache instead of using `useQuery` — a real
// `useQuery({ queryKey: ['currentUser'] })` would attempt its own background
// fetch (there is no queryFn registered here), racing with and overwriting
// the values under test. This probe only observes cache writes made via
// setQueryData / the QueryProvider auth listener.
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
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('restores the persisted cache from a single unscoped IDB key (no user-id suffix)', async () => {
    render(
      <QueryProvider>
        <Probe onClient={(qc) => { capturedClient = qc }} />
      </QueryProvider>
    )

    await waitFor(() => {
      expect(idbGet).toHaveBeenCalled()
    })

    expect(idbGet.mock.calls[0][0]).toBe(IDB_KEY)
  })

  it('persists to the same fixed IDB key regardless of auth state (no scoping by user id)', async () => {
    render(
      <QueryProvider>
        <Probe onClient={(qc) => { capturedClient = qc }} />
      </QueryProvider>
    )

    await waitFor(() => {
      expect(capturedClient).not.toBeNull()
    })

    // Before any auth event — write some data, triggering a persist.
    // The persist subscription only attaches after the async
    // `restoreClient()` resolves, so retry the write (via waitFor) until a
    // write lands while the subscription is active, instead of relying on a
    // single write racing that async setup.
    await waitFor(() => {
      act(() => {
        capturedClient!.setQueryData(['someQuery'], { a: 1 })
      })
      expect(idbSet).toHaveBeenCalled()
    })
    expect(idbSet.mock.calls.at(-1)?.[0]).toBe(IDB_KEY)

    idbSet.mockClear()

    // Simulate INITIAL_SESSION — previously this switched the persister to a
    // user-scoped key (`taskapp-query-cache:<uid>`), causing a restore/persist
    // key mismatch across reloads. It must now stay on the fixed key.
    act(() => {
      authCallback('INITIAL_SESSION', { user: { id: 'user-1' } })
    })
    await waitFor(() => {
      act(() => {
        capturedClient!.setQueryData(['anotherQuery'], { b: 2 })
      })
      expect(idbSet).toHaveBeenCalled()
    })
    for (const call of idbSet.mock.calls) {
      expect(call[0]).toBe(IDB_KEY)
    }
  })

  it('sets currentUser query data to null and clears caches on SIGNED_OUT', async () => {
    const { getByTestId } = render(
      <QueryProvider>
        <Probe onClient={(qc) => { capturedClient = qc }} />
      </QueryProvider>
    )

    await waitFor(() => {
      expect(capturedClient).not.toBeNull()
    })

    act(() => {
      capturedClient!.setQueryData(['currentUser'], { id: 'user-1' })
    })
    expect(getByTestId('user').textContent).toBe('user-1')

    act(() => {
      authCallback('SIGNED_OUT', null)
    })

    await waitFor(() => {
      expect(getByTestId('user').textContent).toBe('null')
    })
  })

  it('sets currentUser query data from the session on SIGNED_IN / INITIAL_SESSION / TOKEN_REFRESHED', async () => {
    const { getByTestId } = render(
      <QueryProvider>
        <Probe onClient={(qc) => { capturedClient = qc }} />
      </QueryProvider>
    )

    await waitFor(() => {
      expect(capturedClient).not.toBeNull()
    })

    act(() => {
      authCallback('INITIAL_SESSION', { user: { id: 'user-1' } })
    })
    await waitFor(() => {
      expect(getByTestId('user').textContent).toBe('user-1')
    })

    act(() => {
      authCallback('TOKEN_REFRESHED', { user: { id: 'user-1' } })
    })
    await waitFor(() => {
      expect(getByTestId('user').textContent).toBe('user-1')
    })

    act(() => {
      authCallback('SIGNED_IN', { user: { id: 'user-2' } })
    })
    await waitFor(() => {
      expect(getByTestId('user').textContent).toBe('user-2')
    })
  })
})
