import { describe, it, expect } from 'vitest'
import { urlBase64ToUint8Array } from '@/lib/push/vapid'

describe('urlBase64ToUint8Array', () => {
  it('decodes a URL-safe base64 VAPID key into bytes', () => {
    // 'hello' base64-encoded, URL-safe (no padding needed here)
    const result = urlBase64ToUint8Array('aGVsbG8')
    expect(Array.from(result)).toEqual(Array.from(Buffer.from('hello')))
  })

  it('handles strings that use URL-safe characters (- and _)', () => {
    // Bytes chosen so the standard base64 encoding contains '+' and '/',
    // which become '-' and '_' respectively in the URL-safe alphabet.
    const original = Buffer.from([0xfb, 0xff, 0xbf])
    const standardB64 = original.toString('base64') // '+ /' variant expected
    const urlSafeB64 = standardB64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

    const result = urlBase64ToUint8Array(urlSafeB64)
    expect(Array.from(result)).toEqual(Array.from(original))
  })

  it('handles strings that require padding to a multiple of 4', () => {
    // 'hi' -> base64 'aGk=' (length 4 with one '=' pad); test without provided padding
    const result = urlBase64ToUint8Array('aGk')
    expect(Array.from(result)).toEqual(Array.from(Buffer.from('hi')))
  })

  it('returns a Uint8Array instance', () => {
    const result = urlBase64ToUint8Array('aGVsbG8')
    expect(result).toBeInstanceOf(Uint8Array)
  })
})
