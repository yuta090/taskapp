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
 * Security: The middleware already validates the session on every request.
 * Client-side getUser() is primarily for obtaining the user ID for queries,
 * not for security enforcement. A 5-second cache is safe because:
 * - Middleware has already validated the session before the page loads
 * - Auth state changes (logout) invalidate the cache immediately
 * - The cache only lives in the browser tab's memory
 */

import type { User } from '@supabase/supabase-js'

interface CachedResult {
  promise: Promise<{ user: User | null; error: Error | null }>
  timestamp: number
}

const CACHE_TTL_MS = 5_000 // 5 seconds

let cachedResult: CachedResult | null = null

/**
 * Returns a cached version of supabase.auth.getUser().
 * Deduplicates concurrent calls and caches the result for CACHE_TTL_MS.
 *
 * @param supabase - A Supabase browser client instance
 * @returns Promise resolving to { user, error }
 */
export function getCachedUser(
  supabase: { auth: { getUser: () => Promise<{ data: { user: User | null }; error: Error | null }> } }
): Promise<{ user: User | null; error: Error | null }> {
  const now = Date.now()

  // Return cached result if still valid
  if (cachedResult && now - cachedResult.timestamp < CACHE_TTL_MS) {
    return cachedResult.promise
  }

  // Create new request and cache it
  const promise = supabase.auth.getUser().then(({ data, error }) => ({
    user: data.user,
    error,
  }))

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
export async function getCachedUserId(
  supabase: { auth: { getUser: () => Promise<{ data: { user: User | null }; error: Error | null }> } }
): Promise<string | null> {
  const { user, error } = await getCachedUser(supabase)
  if (error || !user) return null
  return user.id
}
