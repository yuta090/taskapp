import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import { verifyIngestSignature, signIngestPayload } from '@/lib/channels/discord/ingestAuth'

const SECRET = 'ingest-shared-secret'
const NOW = 1_700_000_500
const TS = String(NOW)

function sig(rawBody: string, timestamp = TS, secret = SECRET): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')
}

describe('signIngestPayload', () => {
  it('timestamp.rawBody を HMAC-SHA256(hex) で署名する（worker と同じ計算）', () => {
    const body = '{"a":1}'
    expect(signIngestPayload(body, TS, SECRET)).toBe(sig(body))
  })
})

describe('verifyIngestSignature', () => {
  it('正しい署名＋時刻内は true', () => {
    const body = '{"events":[]}'
    expect(verifyIngestSignature(body, TS, sig(body), SECRET, NOW)).toBe(true)
  })

  it('署名不一致は false', () => {
    const body = '{"events":[]}'
    expect(verifyIngestSignature(body, TS, 'deadbeef', SECRET, NOW)).toBe(false)
  })

  it('本文改竄は false（署名は生ボディに対して検証）', () => {
    const body = '{"events":[]}'
    const s = sig(body)
    expect(verifyIngestSignature(body + 'x', TS, s, SECRET, NOW)).toBe(false)
  })

  it('署名/timestamp 欠如は false', () => {
    const body = '{}'
    expect(verifyIngestSignature(body, null, sig(body), SECRET, NOW)).toBe(false)
    expect(verifyIngestSignature(body, TS, null, SECRET, NOW)).toBe(false)
  })

  it('5分超のスキュー（古い/未来）は false', () => {
    const body = '{}'
    const oldTs = String(NOW - 400)
    expect(verifyIngestSignature(body, oldTs, sig(body, oldTs), SECRET, NOW)).toBe(false)
    const futureTs = String(NOW + 400)
    expect(verifyIngestSignature(body, futureTs, sig(body, futureTs), SECRET, NOW)).toBe(false)
  })

  it('非数値 timestamp は false', () => {
    const body = '{}'
    expect(verifyIngestSignature(body, 'abc', sig(body, 'abc'), SECRET, NOW)).toBe(false)
  })

  it('secret 未設定は throw（fail-closed・既知鍵で黙って通さない）', () => {
    const body = '{}'
    expect(() => verifyIngestSignature(body, TS, sig(body), '', NOW)).toThrow()
  })
})
