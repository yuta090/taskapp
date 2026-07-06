import { describe, it, expect, vi, afterEach } from 'vitest'
import { checkRateLimit, getClientIp } from './rate-limit'

// `store` is a module-level singleton with no exported reset, so every test
// uses its own unique key to stay isolated from other tests in this file.
let keyCounter = 0
function uniqueKey(): string {
  keyCounter += 1
  return `test-key-${keyCounter}`
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('checkRateLimit', () => {
  it('allows the first request and reports the remaining quota', () => {
    const result = checkRateLimit(uniqueKey(), { maxRequests: 3, windowMs: 1000 })

    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(2)
  })

  it('allows exactly maxRequests, then blocks the next one', () => {
    const key = uniqueKey()
    const config = { maxRequests: 3, windowMs: 1000 }

    const r1 = checkRateLimit(key, config)
    const r2 = checkRateLimit(key, config)
    const r3 = checkRateLimit(key, config)
    const r4 = checkRateLimit(key, config)

    expect([r1.allowed, r2.allowed, r3.allowed]).toEqual([true, true, true])
    expect([r1.remaining, r2.remaining, r3.remaining]).toEqual([2, 1, 0])
    expect(r4.allowed).toBe(false)
    expect(r4.remaining).toBe(0)
  })

  it('computes resetAt as the oldest in-window timestamp plus windowMs', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000)

    const result = checkRateLimit(uniqueKey(), { maxRequests: 2, windowMs: 5000 })

    expect(result.resetAt).toBe(1_000_000 + 5000)
  })

  it('keeps resetAt pinned to the oldest request once blocked (does not advance on rejected attempts)', () => {
    const key = uniqueKey()
    const config = { maxRequests: 1, windowMs: 5000 }

    vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    const r1 = checkRateLimit(key, config)
    expect(r1.allowed).toBe(true)

    vi.spyOn(Date, 'now').mockReturnValue(1_000_500) // still inside the window
    const r2 = checkRateLimit(key, config)

    expect(r2.allowed).toBe(false)
    expect(r2.resetAt).toBe(1_000_000 + 5000) // anchored to the original request, not now
  })

  it('resets the quota once the sliding window has fully elapsed', () => {
    const key = uniqueKey()
    const config = { maxRequests: 1, windowMs: 5000 }

    vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    const r1 = checkRateLimit(key, config)
    expect(r1.allowed).toBe(true)

    vi.spyOn(Date, 'now').mockReturnValue(1_000_000 + 4000) // still within the window
    const r2 = checkRateLimit(key, config)
    expect(r2.allowed).toBe(false)

    vi.spyOn(Date, 'now').mockReturnValue(1_000_000 + 5001) // window has now elapsed
    const r3 = checkRateLimit(key, config)
    expect(r3.allowed).toBe(true)
    expect(r3.remaining).toBe(0)
  })

  it('tracks separate keys independently (rate limiting one key does not affect another)', () => {
    const keyA = uniqueKey()
    const keyB = uniqueKey()
    const config = { maxRequests: 1, windowMs: 1000 }

    const a1 = checkRateLimit(keyA, config)
    const a2 = checkRateLimit(keyA, config) // keyA is now exhausted
    const b1 = checkRateLimit(keyB, config) // keyB is unaffected

    expect(a1.allowed).toBe(true)
    expect(a2.allowed).toBe(false)
    expect(b1.allowed).toBe(true)
  })

  it('runs the periodic background cleanup tick without throwing', async () => {
    // `cleanupTimer` is a module-level singleton created lazily on the first
    // call, so we need a fresh module instance to guarantee `setInterval`
    // is captured under fake timers (rather than reusing a real interval
    // already scheduled by an earlier test in this file).
    vi.useFakeTimers()
    vi.resetModules()
    const fresh = await import('./rate-limit')

    fresh.checkRateLimit('idle-key-1', { maxRequests: 5, windowMs: 1000 })
    fresh.checkRateLimit('idle-key-2', { maxRequests: 5, windowMs: 1000 })

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1) // fails the test if the cleanup tick throws

    // The module keeps working normally after a cleanup pass has run.
    const result = fresh.checkRateLimit('idle-key-3', { maxRequests: 5, windowMs: 1000 })
    expect(result.allowed).toBe(true)
  })
})

describe('getClientIp', () => {
  function makeRequest(headers: Record<string, string>): Request {
    return new Request('https://example.com', { headers })
  }

  it('extracts the first IP from x-forwarded-for, trimming surrounding whitespace', () => {
    const req = makeRequest({ 'x-forwarded-for': ' 1.2.3.4 , 5.6.7.8' })
    expect(getClientIp(req)).toBe('1.2.3.4')
  })

  it('prefers x-forwarded-for over x-real-ip when both are present', () => {
    const req = makeRequest({ 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '9.9.9.9' })
    expect(getClientIp(req)).toBe('1.2.3.4')
  })

  it('falls back to x-real-ip when x-forwarded-for is absent', () => {
    const req = makeRequest({ 'x-real-ip': ' 9.9.9.9 ' })
    expect(getClientIp(req)).toBe('9.9.9.9')
  })

  it('falls back to "unknown" when neither header is present', () => {
    const req = makeRequest({})
    expect(getClientIp(req)).toBe('unknown')
  })
})
