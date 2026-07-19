'use client'

import { QueryClient, defaultShouldDehydrateQuery } from '@tanstack/react-query'
import type { Query } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import type { Persister, PersistedClient } from '@tanstack/react-query-persist-client'
import { get, set, del, keys } from 'idb-keyval'
import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { invalidateCachedUser } from '@/lib/supabase/cached-auth'

const IDB_KEY_PREFIX = 'taskapp-query-cache'

/**
 * Persisted-cache version. When this string changes, PersistQueryClientProvider
 * discards the entire persisted blob on the next load (per user-scoped key) and
 * starts fresh — a one-time cold start, self-healing, no data-correctness impact.
 *
 * ⚠️ 規約（この定数を触るときのルール・厳守）:
 * - **ビルドハッシュにしない**。デプロイ毎に全ユーザーのキャッシュが飛び、永続化の意味が消える。
 *   必ず手動の定数（日付＋理由）にする。
 * - 永続対象クエリの**データ形状**を変えるときの使い分け:
 *   - 単一クエリの形状変更 → その queryKey に版数を入れる（例 `['channelMessages','v2',…]`）。
 *     他クエリのウォームキャッシュを温存できるので**既定はこちら**。
 *   - 複数クエリに波及／影響範囲が不確実 → この buster をバンプして全体を一掃する。
 *
 * 由来: useQuery<ChannelMessageRow[]>（data=配列）→ useInfiniteQuery（data=InfiniteData）へ
 * 変えたのに queryKey を据え置いたため、再訪ユーザーの永続キャッシュ（旧・配列形状）が
 * InfiniteQueryObserver にハイドレートされ `undefined.length` でクラッシュした。複数の併走
 * マージが本番に相乗りしていたため、単一キー版数化ではなく buster 一掃で全パターンを回収する。
 */
export const PERSIST_BUSTER = '2026-07-20-infinite-timeline'

// Legacy key used by a short-lived "single fixed key" design. That design
// caused a cross-tenant data leak: user A closes the tab without signing
// out, user B signs in on the same browser, and `restoreClient` (which ran
// before B's session was known) would hydrate A's persisted tasks/spaces
// into B's query cache — bypassing RLS entirely on the client. Scoped keys
// are the only safe design; this legacy key must be purged, never read.
const LEGACY_UNSCOPED_IDB_KEY = IDB_KEY_PREFIX

/** Build a user-scoped IDB key. Cross-tenant isolation depends on this
 *  scoping — never fall back to an unscoped key. */
function idbKey(userId: string): string {
  return `${IDB_KEY_PREFIX}:${userId}`
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 2 * 60_000, // 2 minutes — balance between speed and multi-user freshness
        gcTime: 1000 * 60 * 60 * 24, // 24 hours — keep cache for persistence
        // 秘書の接続系データは「実質固定」方針(freshness tiers)のため、フォーカス起因の
        // 一斉refetch(ちらつき・負荷源)は既定で無効化する。リアルタイム性が必要な画面は
        // 個別に refetchInterval(polling)を有効化する（useChannelIdentities/useChannelGroups）。
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  })
}

// ['currentUser'] carries PII (email, etc.) and must never be written to
// IDB. It's cheap to re-derive on every load via `restoreClient`'s
// `getSession()` seed below, so persistence buys us nothing for it but adds
// a place PII could linger on disk.
function shouldDehydrateQuery(query: Query): boolean {
  if (query.queryKey[0] === 'currentUser') return false
  return defaultShouldDehydrateQuery(query)
}

interface PersisterDeps {
  supabase: ReturnType<typeof createClient>
  queryClient: QueryClient
  currentUserIdRef: React.RefObject<string | null>
}

/**
 * IDB persister scoped to the *current* session's user id.
 *
 * The user id is resolved inside `restoreClient` itself — synchronously
 * from the localStorage-backed session (`getSession()`, no network round
 * trip) — rather than in a separate effect. React flushes child effects
 * before parent effects, so `PersistQueryClientProvider`'s internal restore
 * effect can run before any effect declared in `QueryProvider`; resolving
 * the uid outside `restoreClient` would reintroduce the original
 * restore/persist key-mismatch race.
 *
 * Default-deny: while the uid is unknown (no session), every method is a
 * no-op. We never read or write an unscoped/shared key, which is what
 * caused the cross-tenant leak this design replaces.
 */
function makeIdbPersister({ supabase, queryClient, currentUserIdRef }: PersisterDeps): Persister {
  return {
    persistClient: async (client: PersistedClient) => {
      const uid = currentUserIdRef.current
      if (!uid) return
      await set(idbKey(uid), client)
    },
    restoreClient: async () => {
      const { data } = await supabase.auth.getSession()
      const uid = data.session?.user?.id ?? null
      currentUserIdRef.current = uid

      // Seed ['currentUser'] immediately — zero extra wait, and this is the
      // only place currentUser data ever comes from since it's excluded
      // from persistence (see shouldDehydrateQuery above).
      queryClient.setQueryData(['currentUser'], data.session?.user ?? null)

      if (!uid) return undefined
      return await get<PersistedClient>(idbKey(uid))
    },
    removeClient: async () => {
      const uid = currentUserIdRef.current
      if (!uid) return
      await del(idbKey(uid))
    },
  }
}

/** Clear all persisted query caches (call on logout / user switch). Matches
 *  both scoped (`taskapp-query-cache:<uid>`) and the legacy unscoped key. */
export async function clearQueryCache() {
  const allKeys = await keys()
  const cacheKeys = allKeys.filter(
    (k) => typeof k === 'string' && k.startsWith(IDB_KEY_PREFIX)
  )
  await Promise.all(cacheKeys.map((k) => del(k)))
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(makeQueryClient)
  const [supabase] = useState(createClient)
  const currentUserIdRef = useRef<string | null>(null)
  // currentUserIdRef.current is only read/written inside the persister's async
  // callbacks (persistClient/restoreClient/removeClient), never during render.
  // eslint-disable-next-line react-hooks/refs
  const [persister] = useState(() =>
    makeIdbPersister({ supabase, queryClient, currentUserIdRef })
  )

  // Clear all persisted/in-memory caches (e.g. on logout or user switch)
  const clearAllCaches = useCallback(() => {
    queryClient.clear()
    void clearQueryCache()
  }, [queryClient])

  // One-time migration: purge the legacy unscoped key left behind by the
  // earlier "single fixed key" design, so no stale cross-user data lingers
  // in IDB even if it's never read.
  useEffect(() => {
    void del(LEGACY_UNSCOPED_IDB_KEY)
  }, [])

  // Keep ['currentUser'] in sync with Supabase auth state, and clear caches
  // on logout / user-identity change. This is defense-in-depth on top of
  // the scoped persister above — restoreClient already resolves the uid
  // once at startup; this listener keeps it correct for the rest of the
  // page's lifetime (login/logout/user-switch without a reload).
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // Always invalidate auth cache on ANY auth state change
      invalidateCachedUser()

      if (event === 'SIGNED_OUT') {
        currentUserIdRef.current = null
        clearAllCaches()
        queryClient.setQueryData(['currentUser'], null)
        return
      }

      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
        const newUserId = session?.user?.id ?? null
        const prevUserId = currentUserIdRef.current
        currentUserIdRef.current = newUserId

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
  }, [supabase, queryClient, clearAllCaches])

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: 1000 * 60 * 60 * 24, // 24 hours
        buster: PERSIST_BUSTER, // bump to discard stale-shape persisted caches (see constant above)
        dehydrateOptions: { shouldDehydrateQuery },
      }}
    >
      {children}
    </PersistQueryClientProvider>
  )
}
