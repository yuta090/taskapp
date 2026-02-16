'use client'

import { QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import type { Persister, PersistedClient } from '@tanstack/react-query-persist-client'
import { get, set, del } from 'idb-keyval'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

const IDB_KEY = 'taskapp-query-cache'

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 1000 * 60 * 60 * 24, // 24 hours — keep cache for persistence
        refetchOnWindowFocus: false,
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

/** Clear persisted query cache (call on logout) */
export async function clearQueryCache() {
  await del(IDB_KEY)
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(makeQueryClient)
  const [persister] = useState(makeIdbPersister)

  // Clear cache on auth state change (user switch / logout)
  useEffect(() => {
    const supabase = createClient()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        // Clear in-memory cache and persisted IndexedDB
        queryClient.clear()
        void del(IDB_KEY)
      }
    })
    return () => subscription.unsubscribe()
  }, [queryClient])

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
