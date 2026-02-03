// Stripe設定状態をチェックするユーティリティ

export interface StripeConfigStatus {
  isConfigured: boolean
  hasPublishableKey: boolean
  missingKeys: string[]
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
  }
}

// サーバーサイドでチェック可能な設定状態
export function getStripeServerConfigStatus(): StripeConfigStatus {
  const secretKey = process.env.STRIPE_SECRET_KEY
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  const proPriceId = process.env.STRIPE_PRO_PRICE_ID
  const enterprisePriceId = process.env.STRIPE_ENTERPRISE_PRICE_ID

  const missingKeys: string[] = []
  if (!secretKey) missingKeys.push('STRIPE_SECRET_KEY')
  if (!webhookSecret) missingKeys.push('STRIPE_WEBHOOK_SECRET')
  if (!proPriceId) missingKeys.push('STRIPE_PRO_PRICE_ID')
  if (!enterprisePriceId) missingKeys.push('STRIPE_ENTERPRISE_PRICE_ID')

  return {
    isConfigured: missingKeys.length === 0,
    hasPublishableKey: !!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    missingKeys,
  }
}
