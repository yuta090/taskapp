'use client'

import { QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import type { Persister, PersistedClient } from '@tanstack/react-query-persist-client'
import { get, set, del, keys } from 'idb-keyval'
import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

const IDB_KEY_PREFIX = 'taskapp-query-cache'

/** Build user-scoped IDB key */
function idbKey(userId: string | null): string {
  return userId ? `${IDB_KEY_PREFIX}:${userId}` : IDB_KEY_PREFIX
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 1000 * 60 * 60 * 24, // 24 hours — keep cache for persistence
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  })
}

function makeIdbPersister(getUserId: () => string | null): Persister {
  return {
    persistClient: async (client: PersistedClient) => {
      const key = idbKey(getUserId())
      await set(key, client)
    },
    restoreClient: async () => {
      const key = idbKey(getUserId())
      return await get<PersistedClient>(key)
    },
    removeClient: async () => {
      const key = idbKey(getUserId())
      await del(key)
    },
  }
}

/** Clear all persisted query caches (call on logout) */
export async function clearQueryCache() {
  const allKeys = await keys()
  const cacheKeys = allKeys.filter(
    (k) => typeof k === 'string' && k.startsWith(IDB_KEY_PREFIX)
  )
  await Promise.all(cacheKeys.map((k) => del(k)))
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(makeQueryClient)
  const currentUserIdRef = useRef<string | null>(null)
  // eslint-disable-next-line react-hooks/refs -- getter only reads .current in async persister callbacks, not during render
  const [persister] = useState(() => makeIdbPersister(() => currentUserIdRef.current))

  // Clear all user-scoped caches
  const clearAllCaches = useCallback(() => {
    queryClient.clear()
    void clearQueryCache()
  }, [queryClient])

  // Clear cache on auth state change (user switch / logout / identity change)
  useEffect(() => {
    const supabase = createClient()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        currentUserIdRef.current = null
        clearAllCaches()
        return
      }

      if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
        const newUserId = session?.user?.id ?? null
        const prevUserId = currentUserIdRef.current

        // On INITIAL_SESSION: if cache exists but user is different (or null), clear it
        if (event === 'INITIAL_SESSION' && !prevUserId && newUserId) {
          // First session load — set user ID, persister will use scoped key
          currentUserIdRef.current = newUserId
          return
        }

        currentUserIdRef.current = newUserId

        // User identity changed — clear stale cache from previous user
        if (prevUserId && newUserId && prevUserId !== newUserId) {
          clearAllCaches()
        }
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
