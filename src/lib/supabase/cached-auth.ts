/**
 * Cached auth helper for browser-side Supabase clients.
 *
 * Problem: Multiple hooks each call `supabase.auth.getUser()` which triggers
 * an HTTP request to Supabase Auth's `/auth/v1/user` endpoint every time.
 * On a typical page load, this causes 2-5 redundant DB round-trips (100-300ms each).
 *
 * Solution: Cache the getUser() result for a short TTL (5 seconds). Within that
 * window, subsequent calls return the cached promise (deduplicating in-flight
 * requests as well). After TTL expiry, the next call fetches fresh data.
 *
 * Locking (2026-09): auth-js's `getUser()` called with no argument acquires an
 * internal per-tab lock for the entire round-trip to the auth server, and every
 * other auth-js call (including the `getSession()` that runs before each
 * authenticated data request) waits on that same lock. Calling `getUser(jwt)`
 * with an explicit access token skips the lock entirely — it verifies the given
 * token directly against the server without touching shared session state.
 * We first read the token locally via `getSession()` (itself lock-scoped but
 * fast — no network unless the token is due for a refresh), then verify it with
 * `getUser(token)`, so the slow network round-trip no longer blocks every other
 * query that needs the lock while it's in flight.
 *
 * Security: 門番（`src/proxy.ts`）は `getSession()`（ローカルのJWTを読むだけ・
 * 認証サーバーには確かめない）でルーティングの判定（未ログインかどうか）だけを行い、
 * 認証サーバーへの本人確認は login/signup/onboarding の検証パスだけで行う。つまり
 * ここの `getCachedUser()` は、クライアント側で本人確認（サーバーへの往復）を担う
 * 数少ない経路の一つ。実際のデータの読み書きの可否は、各リクエストに付くJWTを
 * Supabase側（PostgREST + RLS）が独立に検証するため、この関数のキャッシュが
 * 数秒古くても認可の抜け道にはならない。ログアウト・ユーザー切り替えは
 * `invalidateCachedUser()`（onAuthStateChangeのリスナー）で即座に破棄する。
 */

import type { User } from '@supabase/supabase-js'

interface CachedResult {
  promise: Promise<{ user: User | null; error: Error | null }>
  timestamp: number
}

const CACHE_TTL_MS = 5_000 // 5 seconds

let cachedResult: CachedResult | null = null

interface SupabaseAuthLike {
  auth: {
    getSession: () => Promise<{
      data: { session: { access_token: string } | null }
      error: Error | null
    }>
    getUser: (jwt?: string) => Promise<{ data: { user: User | null }; error: Error | null }>
  }
}

/**
 * Returns a cached version of supabase.auth.getUser().
 * Deduplicates concurrent calls and caches the result for CACHE_TTL_MS.
 *
 * @param supabase - A Supabase browser client instance
 * @returns Promise resolving to { user, error }
 */
export function getCachedUser(
  supabase: SupabaseAuthLike
): Promise<{ user: User | null; error: Error | null }> {
  const now = Date.now()

  // Return cached result if still valid
  if (cachedResult && now - cachedResult.timestamp < CACHE_TTL_MS) {
    return cachedResult.promise
  }

  // getSession() reads the token locally (lock-scoped but fast); getUser(token)
  // then verifies it with the server without taking the lock for that round-trip.
  const promise = supabase.auth.getSession().then(({ data, error: sessionError }) => {
    if (sessionError) return { user: null, error: sessionError }
    return supabase.auth.getUser(data.session?.access_token).then(({ data, error }) => ({
      user: data.user,
      error,
    }))
  })

  cachedResult = { promise, timestamp: now }

  return promise
}

/**
 * Invalidate the cached user (call on logout or auth state change).
 */
export function invalidateCachedUser(): void {
  cachedResult = null
}

/**
 * Get the cached user ID without triggering a new request.
 * Returns null if no cached result is available or if cache has expired.
 * Useful for fire-and-forget operations like audit logs.
 */
export async function getCachedUserId(supabase: SupabaseAuthLike): Promise<string | null> {
  const { user, error } = await getCachedUser(supabase)
  if (error || !user) return null
  return user.id
}
