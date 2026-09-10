import {
  canCreateCheckout,
  getStripeServerConfigStatus,
  isSelfServeCheckoutEnabled,
  REQUIRED_STRIPE_SERVER_KEYS,
} from '@/lib/stripe/config'
import { createClient } from '@/lib/supabase/server'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * 「プランと請求」画面が決済まわりの導線を出してよいかを返す唯一の窓口。
 *
 * 2つを**分けて**返すのが肝心:
 *  - `canCheckout`: 新しくオンラインで申し込めるか（鍵が揃っている AND 受け付けを開けている）
 *  - `keysConfigured`: 既存契約の管理（支払い方法の変更・請求書・解約）ができるか
 *
 * 1つにまとめると、受け付けを閉じた瞬間に**すでに払っている方の解約手段まで消える**。
 * それは今回直した本番障害（有料なのに管理できない）の再発そのもの。
 */
export async function GET(request: NextRequest | Request) {
  // 設定の配備状況（鍵が入っているか）を外に晒さない。使うのはログイン後の画面だけ。
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 受け付けは「全体の元栓」か「その組織の許可リスト」で開く。どちらかで変わるので
  // 画面が見ている組織を受け取って判定する（省略時は全体の元栓だけで判断）。
  const orgId = new URL(request.url).searchParams.get('org_id')

  const status = getStripeServerConfigStatus()
  const selfServeEnabled = isSelfServeCheckoutEnabled()

  return NextResponse.json({
    // 新規のオンライン申し込みに進めるか（鍵 AND 受け付け）
    canCheckout: canCreateCheckout(orgId),
    // 既存契約の管理（支払い方法の変更・請求書・解約）に必要なのは鍵だけ
    keysConfigured: status.isConfigured,
    selfServeEnabled,
    // セキュリティのため、具体的な不足キーは返さない（一部だけ設定済みか、だけを返す）
    partial:
      !status.isConfigured && status.missingKeys.length < REQUIRED_STRIPE_SERVER_KEYS.length,
  })
}
