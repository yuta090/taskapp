/**
 * Simple in-memory sliding-window rate limiter.
 *
 * Suitable for single-instance deployments. For multi-instance deployments
 * this should be replaced with a Redis-backed implementation (e.g. Upstash).
 */

interface RateLimitEntry {
  timestamps: number[]
}

interface RateLimitConfig {
  /** Maximum number of requests allowed within the window */
  maxRequests: number
  /** Time window in milliseconds */
  windowMs: number
}

const store = new Map<string, RateLimitEntry>()

// Periodic cleanup to prevent memory leaks (every 5 minutes)
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000

let cleanupTimer: ReturnType<typeof setInterval> | null = null

function ensureCleanupTimer(windowMs: number): void {
  if (cleanupTimer) return
  cleanupTimer = setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of store.entries()) {
      // Remove entries whose newest timestamp is older than the window
      const newest = entry.timestamps[entry.timestamps.length - 1] ?? 0
      if (now - newest > windowMs * 2) {
        store.delete(key)
      }
    }
  }, CLEANUP_INTERVAL_MS)
  // Allow the process to exit even if the timer is running
  if (typeof cleanupTimer === 'object' && 'unref' in cleanupTimer) {
    cleanupTimer.unref()
  }
}

export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean
  /** Number of remaining requests in the current window */
  remaining: number
  /** Unix timestamp (ms) when the rate limit resets */
  resetAt: number
}

/**
 * Check and consume a rate limit token for the given key.
 *
 * @param key - Unique identifier for the client (e.g. IP address, token prefix)
 * @param config - Rate limit configuration
 * @returns Whether the request is allowed, remaining quota, and reset time
 */
export function checkRateLimit(
  key: string,
  config: RateLimitConfig
): RateLimitResult {
  const { maxRequests, windowMs } = config
  const now = Date.now()
  const windowStart = now - windowMs

  ensureCleanupTimer(windowMs)

  let entry = store.get(key)
  if (!entry) {
    entry = { timestamps: [] }
    store.set(key, entry)
  }

  // Remove timestamps outside the current window
  entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart)

  if (entry.timestamps.length >= maxRequests) {
    // Rate limited
    const oldestInWindow = entry.timestamps[0] ?? now
    const resetAt = oldestInWindow + windowMs
    return {
      allowed: false,
      remaining: 0,
      resetAt,
    }
  }

  // Allow and record
  entry.timestamps.push(now)
  const remaining = maxRequests - entry.timestamps.length

  const oldestInWindow = entry.timestamps[0] ?? now
  const resetAt = oldestInWindow + windowMs

  return {
    allowed: true,
    remaining,
    resetAt,
  }
}

/**
 * Extract a client identifier from a request for rate limiting.
 * Uses X-Forwarded-For (for proxied requests) or falls back to a generic key.
 */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    // Take the first IP (client IP) from the chain
    return forwarded.split(',')[0].trim()
  }

  // Fallback: use a request-level identifier if available
  const realIp = request.headers.get('x-real-ip')
  if (realIp) {
    return realIp.trim()
  }

  return 'unknown'
}
