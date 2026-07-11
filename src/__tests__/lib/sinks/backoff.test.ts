import { describe, it, expect } from 'vitest'
import {
  classifyDeliveryFailure,
  computeNextAttemptDelayMinutes,
  BACKOFF_MINUTES,
  MAX_DELIVERY_ATTEMPTS,
} from '@/lib/sinks/backoff'

/**
 * 恒久/一時失敗の分類とバックオフ計算（§2-2・§10 受け入れ基準7・8）。
 * 恒久失敗（400/404/422）は即dead・consecutive_failuresを押し上げない。
 * 401/403は恒久失敗だがconsecutive_failuresには数える（認証失効の可能性）。
 * 一時失敗（408/429/5xx/timeout）は指数バックオフ 1m→5m→30m→2h→6h、5回リトライ後にdead。
 */

describe('classifyDeliveryFailure', () => {
  it.each([400, 404, 422])('status %i is a permanent failure that does NOT count toward consecutive_failures', (status) => {
    const result = classifyDeliveryFailure(status, false)
    expect(result.outcome).toBe('permanent')
    expect(result.countsTowardFailures).toBe(false)
  })

  it.each([401, 403])('status %i is a permanent failure that DOES count toward consecutive_failures', (status) => {
    const result = classifyDeliveryFailure(status, false)
    expect(result.outcome).toBe('permanent')
    expect(result.countsTowardFailures).toBe(true)
  })

  it.each([408, 429, 500, 502, 503])('status %i is a temporary failure', (status) => {
    const result = classifyDeliveryFailure(status, false)
    expect(result.outcome).toBe('temporary')
    expect(result.countsTowardFailures).toBe(true)
  })

  it('network error / timeout (no status) is a temporary failure', () => {
    const result = classifyDeliveryFailure(undefined, true)
    expect(result.outcome).toBe('temporary')
    expect(result.countsTowardFailures).toBe(true)
  })

  it('an unlisted status (e.g. 3xx redirect not followed) defaults to permanent+counts', () => {
    const result = classifyDeliveryFailure(302, false)
    expect(result.outcome).toBe('permanent')
    expect(result.countsTowardFailures).toBe(true)
  })
})

describe('computeNextAttemptDelayMinutes', () => {
  it('follows the 1m -> 5m -> 30m -> 2h -> 6h schedule for attempts 1..5', () => {
    expect(BACKOFF_MINUTES).toEqual([1, 5, 30, 120, 360])
    expect(computeNextAttemptDelayMinutes(1)).toBe(1)
    expect(computeNextAttemptDelayMinutes(2)).toBe(5)
    expect(computeNextAttemptDelayMinutes(3)).toBe(30)
    expect(computeNextAttemptDelayMinutes(4)).toBe(120)
    expect(computeNextAttemptDelayMinutes(5)).toBe(360)
  })

  it('returns null (dead) once MAX_DELIVERY_ATTEMPTS is reached', () => {
    expect(MAX_DELIVERY_ATTEMPTS).toBe(6)
    expect(computeNextAttemptDelayMinutes(6)).toBeNull()
    expect(computeNextAttemptDelayMinutes(7)).toBeNull()
  })
})
