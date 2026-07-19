'use client'

import { QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import type { Persister, PersistedClient } from '@tanstack/react-query-persist-client'
import { get, set, del, keys } from 'idb-keyval'
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { invalidateCachedUser } from '@/lib/supabase/cached-auth'

// Single, unscoped IDB key. Previously this was scoped per-user
// (`taskapp-query-cache:<uid>`), but `restoreClient` runs on mount — before
// INITIAL_SESSION has resolved the user id — so it always read the unscoped
// key while `persistClient` later wrote to the scoped key. That mismatch
// meant a page reload could never restore the most recently persisted cache.
// A single fixed key avoids the race; per-user isolation is instead handled
// by `clearAllCaches()` on user-identity change (see auth listener below).
const IDB_KEY = 'taskapp-query-cache'

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 2 * 60_000, // 2 minutes — balance between speed and multi-user freshness
        gcTime: 1000 * 60 * 60 * 24, // 24 hours — keep cache for persistence
        refetchOnWindowFocus: true,
        retry: 1,
      },
    },
  })
}

function makeIdbPersister(): Persister {
  return {
    persistClient: async (client: PersistedClient) => {
      await set(IDB_KEY, client)
    },
    restoreClient: async () => {
      return await get<PersistedClient>(IDB_KEY)
    },
    removeClient: async () => {
      await del(IDB_KEY)
    },
  }
}

/** Clear all persisted query caches (call on logout) */
export async function clearQueryCache() {
  const allKeys = await keys()
  const cacheKeys = allKeys.filter(
    (k) => typeof k === 'string' && k.startsWith(IDB_KEY)
  )
  await Promise.all(cacheKeys.map((k) => del(k)))
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(makeQueryClient)
  const [persister] = useState(makeIdbPersister)

  // Clear all persisted/in-memory caches (e.g. on logout or user switch)
  const clearAllCaches = useCallback(() => {
    queryClient.clear()
    void clearQueryCache()
  }, [queryClient])

  // Keep ['currentUser'] in sync with Supabase auth state, and clear caches
  // on logout / user-identity change.
  useEffect(() => {
    const supabase = createClient()
    let currentUserId: string | null = null
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // Always invalidate auth cache on ANY auth state change
      invalidateCachedUser()

      if (event === 'SIGNED_OUT') {
        currentUserId = null
        clearAllCaches()
        queryClient.setQueryData(['currentUser'], null)
        return
      }

      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
        const newUserId = session?.user?.id ?? null
        const prevUserId = currentUserId
        currentUserId = newUserId

        // User identity changed — clear stale cache from previous user
        if (prevUserId && newUserId && prevUserId !== newUserId) {
          clearAllCaches()
        }

        // setQueryData (not invalidate) to avoid a refetch storm on every
        // auth event — the session payload already has the up-to-date user.
        queryClient.setQueryData(['currentUser'], session?.user ?? null)
      }
    })
    return () => subscription.unsubscribe()
  }, [queryClient, clearAllCaches])

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: 1000 * 60 * 60 * 24, // 24 hours
      }}
    >
      {children}
    </PersistQueryClientProvider>
  )
}
