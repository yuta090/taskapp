import { getStripeServerConfigStatus } from '@/lib/stripe/config'
import { NextResponse } from 'next/server'

export async function GET() {
  const status = getStripeServerConfigStatus()

  return NextResponse.json({
    configured: status.isConfigured,
    // セキュリティのため、具体的な不足キーは本番では返さない
    partial: !status.isConfigured && status.missingKeys.length < 4,
  })
}
