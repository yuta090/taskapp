import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import { verifyLineSignature } from '@/lib/channels/line/verify'

/**
 * LINE Messaging API webhook 署名検証
 * https://developers.line.biz/ja/reference/messaging-api/#signature-validation
 *
 * - x-line-signature = base64(HMAC-SHA256(channel secret, request body))
 * - 署名ヘッダ欠落・不一致・秘密鍵違いは全て false
 * - タイミングセーフ比較（長さ違いで例外を出さない）
 */

const CHANNEL_SECRET = 'test-channel-secret'

function sign(body: string, secret: string = CHANNEL_SECRET): string {
  return createHmac('sha256', secret).update(body).digest('base64')
}

describe('verifyLineSignature', () => {
  const body = JSON.stringify({ destination: 'Uxxx', events: [] })

  it('正しい署名なら true', () => {
    expect(verifyLineSignature(body, sign(body), CHANNEL_SECRET)).toBe(true)
  })

  it('本文が改ざんされていたら false', () => {
    expect(verifyLineSignature(body + ' ', sign(body), CHANNEL_SECRET)).toBe(false)
  })

  it('別の秘密鍵で作った署名は false', () => {
    expect(verifyLineSignature(body, sign(body, 'other-secret'), CHANNEL_SECRET)).toBe(false)
  })

  it('署名ヘッダが null なら false', () => {
    expect(verifyLineSignature(body, null, CHANNEL_SECRET)).toBe(false)
  })

  it('署名が空文字なら false', () => {
    expect(verifyLineSignature(body, '', CHANNEL_SECRET)).toBe(false)
  })

  it('長さの異なる不正署名でも例外を出さず false', () => {
    expect(verifyLineSignature(body, 'short', CHANNEL_SECRET)).toBe(false)
  })

  it('マルチバイト本文（日本語）でも検証できる', () => {
    const jp = JSON.stringify({ events: [{ message: { text: '領収書を送ります📎' } }] })
    expect(verifyLineSignature(jp, sign(jp), CHANNEL_SECRET)).toBe(true)
  })
})
