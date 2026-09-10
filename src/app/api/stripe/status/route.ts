import {
  getStripeServerConfigStatus,
  isSelfServeCheckoutEnabled,
  REQUIRED_STRIPE_SERVER_KEYS,
} from '@/lib/stripe/config'
import { NextResponse } from 'next/server'

/**
 * 「プランと請求」画面が決済を出してよいかを返す唯一の窓口。
 *
 * `configured` は**鍵が揃っている**ことと**オンライン申し込みを開けている**ことの両方を満たす
 * ときだけ true。片方だけでは決済導線を開かない（鍵だけ入れた時点でボタンが生きると、
 * Stripe 側の準備前にお客様が決済画面へ進んでしまう）。
 */
export async function GET() {
  const status = getStripeServerConfigStatus()
  const selfServeEnabled = isSelfServeCheckoutEnabled()

  return NextResponse.json({
    configured: status.isConfigured && selfServeEnabled,
    keysConfigured: status.isConfigured,
    selfServeEnabled,
    // セキュリティのため、具体的な不足キーは返さない（一部だけ設定済みか、だけを返す）
    partial:
      !status.isConfigured && status.missingKeys.length < REQUIRED_STRIPE_SERVER_KEYS.length,
  })
}
