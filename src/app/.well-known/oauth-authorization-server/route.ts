import { NextRequest, NextResponse } from 'next/server'

/**
 * 許可を出す側（AgentPM 自身）の案内。つなぎ先はここを読んで、登録先・同意画面・
 * 合鍵の受け取り先を知る。
 *
 * ⚠ PKCE は S256 のみ。plain は載せない（載せると、その方式で来る）。
 */
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin
  return NextResponse.json(
    {
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/api/oauth/token`,
      registration_endpoint: `${origin}/api/oauth/register`,
      scopes_supported: ['agentpm.read', 'agentpm.write'],
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    },
    { headers: { 'Cache-Control': 'public, max-age=3600' } },
  )
}
