import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { isSelfServeCheckoutEnabled } from '@/lib/stripe/config'

/**
 * オンラインでの申し込み（セルフサーブ決済）を開くかどうかの元栓。
 *
 * **なぜ鍵の有無と別に持つのか**: 鍵が揃った瞬間に決済ボタンが開くと、Stripe 側の準備
 * （本番モードへの切替・商品と価格・Webhook・特商法まわり）が終わる前に、お客様が
 * 決済画面に入れてしまう。鍵は「技術的に呼べるか」、この元栓は「営業として受け付けるか」で、
 * 判断が別物なので分けて持つ。**既定は閉**（明示的に開けたときだけ開く）。
 */

describe('isSelfServeCheckoutEnabled', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('未設定なら閉じている（うっかり本番で決済が始まらない）', () => {
    delete process.env.STRIPE_SELF_SERVE_ENABLED

    expect(isSelfServeCheckoutEnabled()).toBe(false)
  })

  it("'true' のときだけ開く", () => {
    process.env.STRIPE_SELF_SERVE_ENABLED = 'true'

    expect(isSelfServeCheckoutEnabled()).toBe(true)
  })

  it('紛らわしい値では開かない', () => {
    for (const value of ['false', '1', 'yes', 'TRUE', '', 'on']) {
      process.env.STRIPE_SELF_SERVE_ENABLED = value
      expect(isSelfServeCheckoutEnabled(), `value=${value}`).toBe(false)
    }
  })
})
