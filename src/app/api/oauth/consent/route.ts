import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { matchesRegisteredRedirectUri } from '@/lib/mcp/oauth/validation'
import { createAuthorizationCode, getClient } from '@/lib/mcp/oauth/store'
import { actionsForLevel, canConnectOrg, isConsentLevel } from '@/lib/mcp/oauth/consent'

/**
 * 同意画面の「許可する」を受ける口。
 *
 * ⚠ ここが本物の権限を出す瞬間。次を必ず守る:
 *   - ログイン済み本人であること（cookie の session を見る）
 *   - その組織の社内メンバーであること（相手先・協力会社は不可）
 *   - 戻り先が登録どおり完全一致であること
 *   - 断るときは、戻り先へ飛ばさずこちらで止める（なりすましの戻り先へ何も渡さない）
 */
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: '本文を読めません' }, { status: 400 })

  const clientId = String(form.get('client_id') || '')
  const redirectUri = String(form.get('redirect_uri') || '')
  const state = String(form.get('state') || '')
  const codeChallenge = String(form.get('code_challenge') || '')
  const orgId = String(form.get('org_id') || '')
  const level = String(form.get('level') || 'read')
  const decision = String(form.get('decision') || '')

  const client = await getClient(clientId)
  if (!client) {
    return NextResponse.json({ error: '登録されていないつなぎ先です' }, { status: 400 })
  }
  // 戻り先が登録どおりでなければ、絶対にそこへ飛ばさない
  if (!matchesRegisteredRedirectUri(client.redirectUris, redirectUri)) {
    return NextResponse.json({ error: '戻り先が登録と一致しません' }, { status: 400 })
  }

  const target = new URL(redirectUri)
  if (state) target.searchParams.set('state', state)

  // 断った場合。戻り先は登録どおりだと確かめた後なので、ここへは返してよい
  if (decision !== 'approve') {
    target.searchParams.set('error', 'access_denied')
    target.searchParams.set('error_description', '接続を許可しませんでした')
    return NextResponse.redirect(target, 303)
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 })
  }

  if (!isConsentLevel(level)) {
    return NextResponse.json({ error: '許可する範囲の指定が不正です' }, { status: 400 })
  }
  if (!codeChallenge) {
    return NextResponse.json({ error: 'PKCE の指定がありません' }, { status: 400 })
  }
  if (!(await canConnectOrg(supabase, user.id, orgId))) {
    return NextResponse.json(
      { error: 'この組織では外部チャットにつなげません（社内メンバーのみ）' },
      { status: 403 },
    )
  }

  try {
    const code = await createAuthorizationCode({
      clientId,
      userId: user.id,
      orgId,
      redirectUri,
      codeChallenge,
      allowedActions: actionsForLevel(level),
    })
    target.searchParams.set('code', code)
    return NextResponse.redirect(target, 303)
  } catch (error) {
    console.error('POST /api/oauth/consent error:', error)
    return NextResponse.json({ error: '接続を許可できませんでした' }, { status: 500 })
  }
}
