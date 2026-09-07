/**
 * 一般 API（利用者として認証したあと service role で DB を触るルート）用の二要素認証ゲート。
 *
 * RLS 経由のクエリは DB 側の RESTRICTIVE ポリシー（public.mfa_satisfied）で自動的に守られるが、
 * service role は RLS の対象外なので、getUser() の直後にこれを呼んで「登録済み × コード未入力」を弾く。
 * 判定は src/lib/auth/requireAal2.ts（検証済み JWT の aal ＋ Auth API の factor 一覧）。
 */
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { checkAal2 } from './requireAal2'

/** 通してよければ null、弾くなら 403 レスポンス（未ログインは呼び出し側の 401 に任せる） */
export async function mfaGuardResponse(supabase: SupabaseClient): Promise<NextResponse | null> {
  const r = await checkAal2(supabase)
  if (r.ok || r.reason === 'unauthenticated' || r.reason === 'mfa_not_enrolled') return null
  return NextResponse.json({ error: 'mfa_required', message: '二要素認証のコード入力が必要です' }, { status: 403 })
}
