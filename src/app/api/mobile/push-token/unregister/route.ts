import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * POST /api/mobile/push-token/unregister { token }
 *
 * スマホアプリのログインが切れた端末（ログインの期限切れ・他の端末からの全端末ログアウト）は、
 * もう自分の mobile_push_tokens の行を消せない。そのままだと前の人の通知がその端末に届き続けるので、
 * Expo のトークン文字列を持っていること（端末と DB にしか無い）を証明にして、その行を消す。
 *
 * 認証なし。消すのはトークンが一致する行だけ（user_id は body から受け取らない）。
 * 最悪でも「自分が持っているトークンの通知が止まる」だけで、次の起動時の登録で元に戻る。
 * 行の有無は返さない（常に ok）。通常のログアウトはアプリが RLS で自分の行を消す（こちらは予備）。
 */

// migration（*_mobile_push_tokens.sql）の check 制約と同じ形
const TOKEN_RE = /^Expo(nent)?PushToken\[[^\]]+\]$/
const MAX_TOKEN_LENGTH = 200
const RATE_LIMIT = { maxRequests: 30, windowMs: 10 * 60 * 1000 }

export async function POST(request: NextRequest) {
  const rate = checkRateLimit(`push-token-unregister:${getClientIp(request)}`, RATE_LIMIT)
  if (!rate.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const token = body?.token
  if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH || !TOKEN_RE.test(token)) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 400 })
  }

  const admin = createAdminClient({ channel: 'app' }) as SupabaseClient
  const { error } = await admin.from('mobile_push_tokens').delete().eq('token', token)
  if (error) {
    console.error('[mobile/push-token/unregister] Failed to delete token:', error.message)
    return NextResponse.json({ error: 'Failed to unregister' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
