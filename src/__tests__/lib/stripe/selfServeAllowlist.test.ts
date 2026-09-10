import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { canCreateCheckout, isSelfServeAllowedForOrg } from '@/lib/stripe/config'

/**
 * 「この組織だけ決済を通す」許可リスト。
 *
 * **なぜ要るか**: 元栓（STRIPE_SELF_SERVE_ENABLED）はサイト全体に効くので、本番で決済を
 * 一度試すには全員に開けるしかなかった。試すあいだ、他のお客様も申し込めてしまう。
 * 許可リストがあれば、**自分の組織だけ本番URLで購入まで通し**、他のお客様には
 * 「準備中」のままにできる。試し終わったら設定を消すだけ。
 *
 * 鍵（決済キー・Webhook・Proの商品ID）は許可リストでも省略しない。
 * 鍵が欠けたまま決済だけ通ると「払えたのにプランが上がらない」を作るため。
 */

const ORG = '11111111-2222-3333-4444-555555555555'
const OTHER_ORG = '99999999-8888-7777-6666-555555555555'

function setKeys() {
  process.env.STRIPE_SECRET_KEY = 'sk_test_xxx'
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_xxx'
  process.env.STRIPE_PRO_PRICE_ID = 'price_pro'
}

describe('セルフサーブの組織許可リスト', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
    delete process.env.STRIPE_SELF_SERVE_ENABLED
    delete process.env.STRIPE_SELF_SERVE_ORG_IDS
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('許可リストに入っている組織だけ通す（元栓は閉じたまま）', () => {
    setKeys()
    process.env.STRIPE_SELF_SERVE_ORG_IDS = ORG

    expect(isSelfServeAllowedForOrg(ORG)).toBe(true)
    expect(isSelfServeAllowedForOrg(OTHER_ORG)).toBe(false)
    expect(canCreateCheckout(ORG)).toBe(true)
    expect(canCreateCheckout(OTHER_ORG)).toBe(false)
  })

  it('組織が分からないときは通さない（元栓が閉じている場合）', () => {
    setKeys()
    process.env.STRIPE_SELF_SERVE_ORG_IDS = ORG

    expect(canCreateCheckout(undefined)).toBe(false)
  })

  it('元栓が開いていれば、許可リストが無くても全組織が通る', () => {
    setKeys()
    process.env.STRIPE_SELF_SERVE_ENABLED = 'true'

    expect(canCreateCheckout(OTHER_ORG)).toBe(true)
    expect(canCreateCheckout(undefined)).toBe(true)
  })

  it('許可リストに入っていても、鍵が欠けていれば通さない', () => {
    setKeys()
    delete process.env.STRIPE_WEBHOOK_SECRET // 決済後の同期が動かない
    process.env.STRIPE_SELF_SERVE_ORG_IDS = ORG

    expect(canCreateCheckout(ORG)).toBe(false)
  })

  it('カンマ区切り・空白・空要素を許す（貼り付けの事故で通らなくならないように）', () => {
    setKeys()
    process.env.STRIPE_SELF_SERVE_ORG_IDS = ` ${OTHER_ORG} , , ${ORG} ,`

    expect(isSelfServeAllowedForOrg(ORG)).toBe(true)
    expect(isSelfServeAllowedForOrg(OTHER_ORG)).toBe(true)
  })

  it('大文字小文字の違いは同じ組織として扱う（UUIDの表記ゆれ）', () => {
    setKeys()
    process.env.STRIPE_SELF_SERVE_ORG_IDS = ORG.toUpperCase()

    expect(isSelfServeAllowedForOrg(ORG)).toBe(true)
  })

  it('未設定なら誰も通さない（既定は閉のまま）', () => {
    setKeys()

    expect(isSelfServeAllowedForOrg(ORG)).toBe(false)
    expect(canCreateCheckout(ORG)).toBe(false)
  })
})
