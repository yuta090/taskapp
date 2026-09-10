// Stripe設定状態をチェックするユーティリティ

export interface StripeConfigStatus {
  isConfigured: boolean
  hasPublishableKey: boolean
  /** 決済を出すのに必須なのに無いもの */
  missingKeys: string[]
  /** 無くても決済は出せるが、設定しておくと運用が楽になるもの */
  missingOptionalKeys: string[]
}

// クライアントサイドでチェック可能な設定状態
export function getStripeClientConfigStatus(): StripeConfigStatus {
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY

  const missingKeys: string[] = []
  if (!publishableKey) {
    missingKeys.push('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY')
  }

  return {
    isConfigured: missingKeys.length === 0,
    hasPublishableKey: !!publishableKey,
    missingKeys,
    missingOptionalKeys: [],
  }
}

/**
 * サーバー側の設定状態。
 *
 * ⚠ **Enterprise の商品IDは必須にしない。**Enterprise は営業窓口での個別契約で、Stripe の
 * 決済画面を通らない（`/api/stripe/checkout` は `enterprise` を `enterprise_contact_sales` で
 * 弾く）。ここを必須にしていたため、**本番で Enterprise の商品IDが無いというだけの理由で
 * Pro の決済まで止まっていた**。売るのに要るのは「決済キー・Webhook・Proの商品ID」の3つ。
 *
 * Enterprise の商品IDは、Stripe 側に Enterprise の契約が実在する場合に、その契約をプランへ
 * 読み替える（stripeSync / billing-reconcile）ために使う。無くても Pro の販売は成立する。
 */
export const REQUIRED_STRIPE_SERVER_KEYS = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PRO_PRICE_ID',
] as const

/**
 * オンラインでの申し込み（セルフサーブ決済）を受け付けるかどうかの元栓。
 *
 * 鍵が揃っていること（技術的に呼べる）と、受け付けてよいこと（Stripe 側の本番切替・商品と価格・
 * 特商法まわりの準備が済んでいる）は別の判断なので分けて持つ。**既定は閉**で、
 * `STRIPE_SELF_SERVE_ENABLED=true` を明示したときだけ開く。
 * 画面のボタンだけでなく `/api/stripe/checkout` でも効かせる（直接叩かれても素通りさせない）。
 */
export function isSelfServeCheckoutEnabled(): boolean {
  return process.env.STRIPE_SELF_SERVE_ENABLED === 'true'
}

export function getStripeServerConfigStatus(): StripeConfigStatus {
  const missingKeys = REQUIRED_STRIPE_SERVER_KEYS.filter((key) => !process.env[key])

  const missingOptionalKeys: string[] = []
  if (!process.env.STRIPE_ENTERPRISE_PRICE_ID) {
    missingOptionalKeys.push('STRIPE_ENTERPRISE_PRICE_ID')
  }

  return {
    isConfigured: missingKeys.length === 0,
    hasPublishableKey: !!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    missingKeys: [...missingKeys],
    missingOptionalKeys,
  }
}

/**
 * オンラインで決済に進んでよいか。**画面もサーバも必ずここを通す**（判定を二重に持たない）。
 *
 * 鍵が揃っていること（技術的に呼べる）と、受け付けを開けていること（営業判断）の両方が要る。
 * 片方だけで通すと、たとえば Webhook の鍵が無いまま決済だけ成立し、**支払われたのに
 * プランが上がらない**（同期が動かない）状態を作ってしまう。
 */
export function canCreateCheckout(): boolean {
  return getStripeServerConfigStatus().isConfigured && isSelfServeCheckoutEnabled()
}
