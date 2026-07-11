import { describe, it, expect } from 'vitest'
import { buildSignatureHeader, verifySinkSignature, signSinkPayload } from '@/lib/sinks/signature'

/**
 * Webhook署名: X-AgentPM-Signature: t=<unix秒>,v1=<hex(hmac_sha256(secret, t + "." + body))>
 * Stripe/Slack同型。§10 受け入れ基準5: 「署名が Stripe 同型（t + v1）で検証可能・リプレイ窓5分」
 */

const SECRET = 'whsec_test_secret'
const BODY = JSON.stringify({ hello: 'world' })

describe('signSinkPayload', () => {
  it('is deterministic for the same secret/timestamp/body', () => {
    const a = signSinkPayload(SECRET, 1700000000, BODY)
    const b = signSinkPayload(SECRET, 1700000000, BODY)
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it('changes when the body changes', () => {
    const a = signSinkPayload(SECRET, 1700000000, BODY)
    const b = signSinkPayload(SECRET, 1700000000, JSON.stringify({ hello: 'mars' }))
    expect(a).not.toBe(b)
  })

  it('changes when the secret changes', () => {
    const a = signSinkPayload(SECRET, 1700000000, BODY)
    const b = signSinkPayload('different_secret', 1700000000, BODY)
    expect(a).not.toBe(b)
  })
})

describe('buildSignatureHeader / verifySinkSignature (round trip)', () => {
  it('produces a header in the "t=...,v1=..." format', () => {
    const header = buildSignatureHeader(SECRET, BODY, 1700000000)
    expect(header).toBe(`t=1700000000,v1=${signSinkPayload(SECRET, 1700000000, BODY)}`)
  })

  it('verifies a freshly signed header', () => {
    const header = buildSignatureHeader(SECRET, BODY, 1700000000)
    const result = verifySinkSignature(SECRET, BODY, header, 1700000000)
    expect(result.ok).toBe(true)
  })

  it('rejects a tampered body', () => {
    const header = buildSignatureHeader(SECRET, BODY, 1700000000)
    const result = verifySinkSignature(SECRET, JSON.stringify({ hello: 'tampered' }), header, 1700000000)
    expect(result.ok).toBe(false)
  })

  it('rejects the wrong secret', () => {
    const header = buildSignatureHeader(SECRET, BODY, 1700000000)
    const result = verifySinkSignature('wrong_secret', BODY, header, 1700000000)
    expect(result.ok).toBe(false)
  })

  it('rejects a malformed header', () => {
    const result = verifySinkSignature(SECRET, BODY, 'not-a-valid-header', 1700000000)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('malformed_header')
  })

  it('accepts within the 5 minute replay window', () => {
    const header = buildSignatureHeader(SECRET, BODY, 1700000000)
    const result = verifySinkSignature(SECRET, BODY, header, 1700000000 + 299)
    expect(result.ok).toBe(true)
  })

  it('rejects outside the 5 minute replay window', () => {
    const header = buildSignatureHeader(SECRET, BODY, 1700000000)
    const result = verifySinkSignature(SECRET, BODY, header, 1700000000 + 301)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('timestamp_out_of_window')
  })

  it('rejects a timestamp from the future beyond the window', () => {
    const header = buildSignatureHeader(SECRET, BODY, 1700000000)
    const result = verifySinkSignature(SECRET, BODY, header, 1700000000 - 301)
    expect(result.ok).toBe(false)
  })
})
