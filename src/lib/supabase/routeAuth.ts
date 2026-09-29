import type { NextRequest } from 'next/server'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { createBearerClient } from '@/lib/supabase/bearer'
import { createClient as createCookieClient } from '@/lib/supabase/server'

/**
 * スマホアプリ（Authorization: Bearer <アクセストークン>）とブラウザ（Cookie）の両方から呼ばれる
 * ルートの本人確認。**呼んだルートだけ**が Bearer を受け付ける（server.ts の createClient は Cookie のまま）。
 * 使っているルート: /api/portal/notify-approval・/api/slack/notify
 *
 * - Authorization が Bearer なら Bearer だけで確かめる。無効なら null（Cookie には戻らない＝取り違えない）
 * - 無ければ今までどおり Cookie のログイン
 * accessToken は getUser() で確かめ済みのものだけを返す。2段階認証の確認（mfaGuardResponse）に
 * そのまま渡す（Bearer のクライアントはセッションを持たないので、渡さないと登録者が必ず弾かれる）。
 * ログに Authorization を出さないこと。
 */
export interface RouteAuth {
  supabase: SupabaseClient<Database>
  user: User
  accessToken: string | null
  via: 'bearer' | 'cookie'
}

const BEARER_RE = /^Bearer\s+(\S+)$/i
const MAX_TOKEN_LENGTH = 4096

export async function createRouteAuth(request: NextRequest): Promise<RouteAuth | null> {
  const header = request.headers.get('authorization')
  // Bearer のときだけ Bearer で確かめる。Basic など他の形式（手前に置いた Basic 認証でブラウザが
  // 付けるもの）は Cookie のログインで確かめる
  if (header !== null && /^Bearer(\s|$)/i.test(header)) {
    const match = BEARER_RE.exec(header)
    if (!match || match[1].length > MAX_TOKEN_LENGTH) return null
    const accessToken = match[1]
    const supabase = createBearerClient(accessToken)
    const { data, error } = await supabase.auth.getUser(accessToken)
    if (error || !data.user) return null
    return { supabase, user: data.user, accessToken, via: 'bearer' }
  }

  const supabase = await createCookieClient()
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) return null
  const { data: sessionData } = await supabase.auth.getSession()
  return { supabase, user: data.user, accessToken: sessionData.session?.access_token ?? null, via: 'cookie' }
}
