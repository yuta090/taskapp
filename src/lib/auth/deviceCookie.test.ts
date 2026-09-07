import { describe, it, expect, vi } from 'vitest'
import {
  DEVICE_COOKIE_NAME,
  DEVICE_ID_RE,
  DEVICE_PENDING_COOKIE_NAME,
  deviceCookieOptions,
  devicePendingCookieOptions,
} from './deviceCookie'

describe('deviceCookie', () => {
  it('cookie名は固定', () => {
    expect(DEVICE_COOKIE_NAME).toBe('agentpm_device')
    expect(DEVICE_PENDING_COOKIE_NAME).toBe('agentpm_device_pending')
  })

  it('DEVICE_ID_RE は32byte(64文字hex)だけを許す', () => {
    expect(DEVICE_ID_RE.test('a'.repeat(64))).toBe(true)
    expect(DEVICE_ID_RE.test('a'.repeat(63))).toBe(false)
    expect(DEVICE_ID_RE.test('A'.repeat(64))).toBe(false)
    expect(DEVICE_ID_RE.test('z'.repeat(64))).toBe(false)
    expect(DEVICE_ID_RE.test('<script>')).toBe(false)
  })

  it('deviceCookieOptions: httpOnly・lax・全パス・400日、本番のみsecure', () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect(deviceCookieOptions()).toEqual({ httpOnly: true, secure: false, sameSite: 'lax', path: '/', maxAge: 400 * 24 * 60 * 60 })
    vi.stubEnv('NODE_ENV', 'production')
    expect(deviceCookieOptions().secure).toBe(true)
    vi.unstubAllEnvs()
  })

  it('devicePendingCookieOptions: 5分・本番のみsecure', () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect(devicePendingCookieOptions()).toEqual({ httpOnly: true, secure: false, sameSite: 'lax', path: '/', maxAge: 5 * 60 })
    vi.stubEnv('NODE_ENV', 'production')
    expect(devicePendingCookieOptions().secure).toBe(true)
    vi.unstubAllEnvs()
  })
})
