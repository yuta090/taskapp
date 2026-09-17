import { NextRequest, NextResponse } from 'next/server'
import { isAllowedRedirectUri, sanitizeClientName } from '@/lib/mcp/oauth/validation'
import { hashClientIp } from '@/lib/mcp/oauth/secrets'
import { registerClient, tooManyRecentRegistrations } from '@/lib/mcp/oauth/store'

/**
 * つなぎ先の登録（Dynamic Client Registration）。
 *
 * ⚠ 誰でも登録できる口。ChatGPT は利用者ごとに新しい登録を作るので、相手を名簿で
 * 絞ることができない。そのかわり **登録しただけでは何の権限も付かない**。
 * ここでできるのは「許可を求める画面を開ける状態になる」ことだけで、
 * ログイン済み本人が同意画面で承諾しない限り、データには一切触れない。
 *
 * ここで守るのは3つ:
 *   1. 戻り先は https（手元の開発ツール向けにループバック http だけ例外）
 *   2. 表示名は制御文字を落として64文字まで（同意画面の表示を崩させない）
 *   3. 同じ相手からの登録は1時間に10件まで
 */
export const runtime = 'nodejs'

function badRequest(error: string, description: string) {
  return NextResponse.json({ error, error_description: description }, { status: 400 })
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return badRequest('invalid_client_metadata', 'JSON として読めません')
  }

  const rawName = typeof body.client_name === 'string' ? body.client_name : ''
  const clientName = sanitizeClientName(rawName)
  if (!clientName) {
    return badRequest('invalid_client_metadata', 'client_name が必要です')
  }

  const rawUris = body.redirect_uris
  if (!Array.isArray(rawUris) || rawUris.length === 0 || rawUris.length > 5) {
    return badRequest('invalid_redirect_uri', 'redirect_uris は1〜5件必要です')
  }

  const redirectUris = rawUris.filter((u): u is string => typeof u === 'string')
  if (redirectUris.length !== rawUris.length || !redirectUris.every(isAllowedRedirectUri)) {
    return badRequest(
      'invalid_redirect_uri',
      'redirect_uris は https のみ受け付けます（手元の開発ツール向けに http://127.0.0.1 と http://localhost は可）',
    )
  }

  // 受け取れる形をここで固定する。ほかの方式で来たら断る
  const grantTypes = Array.isArray(body.grant_types) ? body.grant_types : ['authorization_code']
  if (!grantTypes.every((g) => g === 'authorization_code' || g === 'refresh_token')) {
    return badRequest('invalid_client_metadata', 'grant_types は authorization_code と refresh_token のみです')
  }

  const responseTypes = Array.isArray(body.response_types) ? body.response_types : ['code']
  if (!responseTypes.every((r) => r === 'code')) {
    return badRequest('invalid_client_metadata', 'response_types は code のみです')
  }

  const authMethod = typeof body.token_endpoint_auth_method === 'string' ? body.token_endpoint_auth_method : 'none'
  if (authMethod !== 'none') {
    return badRequest('invalid_client_metadata', 'token_endpoint_auth_method は none のみです（PKCE で守ります）')
  }

  const ipHash = hashClientIp(
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip'),
  )

  try {
    if (await tooManyRecentRegistrations(ipHash)) {
      return NextResponse.json(
        { error: 'invalid_client_metadata', error_description: '登録が多すぎます。しばらく待ってからやり直してください' },
        { status: 429 },
      )
    }

    const client = await registerClient({ clientName, redirectUris, ipHash })

    return NextResponse.json(
      {
        client_id: client.clientId,
        client_name: client.clientName,
        redirect_uris: client.redirectUris,
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      },
      { status: 201 },
    )
  } catch (error) {
    console.error('POST /api/oauth/register error:', error)
    return NextResponse.json({ error: 'server_error', error_description: '登録できませんでした' }, { status: 500 })
  }
}
