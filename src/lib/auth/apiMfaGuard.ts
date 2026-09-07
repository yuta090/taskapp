/**
 * 一般 API（利用者として認証したあと service role で DB を触るルート）用の二要素認証ゲート。
 *
 * RLS 経由のクエリは DB 側（pre-request 関数と RESTRICTIVE ポリシー）で自動的に守られるが、
 * service role は RLS の対象外なので、getUser() の直後にこれを呼んで「登録済み × コード未入力」を弾く。
 * 判定は src/lib/auth/requireAal2.ts。取得済みの user を渡すと Auth API への往復を増やさない。
 */
import { NextResponse } from 'next/server'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { checkAal2 } from './requireAal2'
import { MFA_CHALLENGE_PATH } from './mfa'

/** 通してよければ null、弾くなら 403 レスポンス（未ログインは呼び出し側の 401 に任せる） */
export async function mfaGuardResponse(supabase: SupabaseClient, user?: User | null): Promise<NextResponse | null> {
  const r = await checkAal2(supabase, { user })
  if (r.ok || r.reason === 'unauthenticated' || r.reason === 'mfa_not_enrolled') return null
  return NextResponse.json({ error: 'mfa_required', message: '二要素認証のコード入力が必要です' }, { status: 403 })
}

/** OAuth コールバック等、画面へ戻すルート用: 弾くならコード入力画面へのリダイレクト、通すなら null */
export async function mfaRedirectResponse(supabase: SupabaseClient, user: User | null | undefined, appUrl: string, backTo: string): Promise<NextResponse | null> {
  const r = await checkAal2(supabase, { user })
  if (r.ok || r.reason === 'unauthenticated' || r.reason === 'mfa_not_enrolled') return null
  return NextResponse.redirect(`${appUrl}${MFA_CHALLENGE_PATH}?redirect=${encodeURIComponent(backTo)}`)
}
