import { NextRequest, NextResponse } from 'next/server'
import { verifyPkceS256 } from '@/lib/mcp/oauth/validation'
import {
  consumeAuthorizationCode,
  createOAuthApiKey,
  getClient,
  issueTokens,
  rotateRefreshToken,
} from '@/lib/mcp/oauth/store'

/**
 * 引換券を合鍵に替える口と、合鍵を付け替える口。
 *
 * ⚠ ここを通ると本物の権限が出る。守るのは:
 *   - 引換券は一度きり。使い回しを見つけたら、そこから出た合鍵を全部止める
 *   - PKCE（S256）の照合。引換券を横取りされても、最初に求めた本人しか引き換えられない
 *   - redirect_uri は許可を求めたときと同じものであること
 *   - 付け替え用の合鍵も一度きり。使い回しは系列ごと止める
 */
export const runtime = 'nodejs'

function oauthError(error: string, description: string, status = 400) {
  return NextResponse.json(
    { error, error_description: description },
    { status, headers: { 'Cache-Control': 'no-store' } },
  )
}

async function readParams(request: NextRequest): Promise<Record<string, string>> {
  const contentType = request.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    const body = (await request.json()) as Record<string, unknown>
    return Object.fromEntries(Object.entries(body).map(([k, v]) => [k, String(v ?? '')]))
  }
  const form = await request.formData()
  return Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]))
}

export async function POST(request: NextRequest) {
  let params: Record<string, string>
  try {
    params = await readParams(request)
  } catch {
    return oauthError('invalid_request', '本文を読めません')
  }

  const grantType = params.grant_type
  const clientId = params.client_id
  if (!clientId) return oauthError('invalid_client', 'client_id が必要です')

  const client = await getClient(clientId)
  if (!client) return oauthError('invalid_client', '登録されていないつなぎ先です')

  if (grantType === 'authorization_code') {
    const { code, code_verifier: verifier, redirect_uri: redirectUri } = params
    if (!code) return oauthError('invalid_request', 'code が必要です')
    if (!verifier) return oauthError('invalid_request', 'code_verifier が必要です（PKCE 必須）')

    const consumed = await consumeAuthorizationCode(code)
    // 見つからない・期限切れ・使用済み（使用済みのときは store 側で合鍵を失効させている）
    if (!consumed) return oauthError('invalid_grant', '引換券が無効か、すでに使われています')

    if (consumed.clientId !== clientId) {
      return oauthError('invalid_grant', '引換券が別のつなぎ先のものです')
    }
    if (redirectUri && consumed.redirectUri !== redirectUri) {
      return oauthError('invalid_grant', '許可を求めたときと戻り先が違います')
    }
    if (!(await verifyPkceS256(verifier, consumed.codeChallenge))) {
      return oauthError('invalid_grant', 'code_verifier が合いません')
    }

    try {
      const apiKeyId = await createOAuthApiKey({
        clientId,
        clientName: client.clientName,
        userId: consumed.userId,
        orgId: consumed.orgId,
        allowedActions: consumed.allowedActions,
      })

      const tokens = await issueTokens({
        clientId,
        userId: consumed.userId,
        orgId: consumed.orgId,
        apiKeyId,
        authorizationCodeId: consumed.id,
      })

      return NextResponse.json(
        {
          access_token: tokens.accessToken,
          refresh_token: tokens.refreshToken,
          token_type: 'Bearer',
          expires_in: tokens.expiresIn,
          scope: consumed.allowedActions.map((a) => `agentpm.${a}`).join(' '),
        },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    } catch (error) {
      console.error('POST /api/oauth/token (code) error:', error)
      return oauthError('server_error', '接続を作れませんでした', 500)
    }
  }

  if (grantType === 'refresh_token') {
    const refreshToken = params.refresh_token
    if (!refreshToken) return oauthError('invalid_request', 'refresh_token が必要です')

    try {
      const tokens = await rotateRefreshToken(refreshToken, clientId)
      if (!tokens) return oauthError('invalid_grant', '合鍵が無効か、すでに使われています')

      return NextResponse.json(
        {
          access_token: tokens.accessToken,
          refresh_token: tokens.refreshToken,
          token_type: 'Bearer',
          expires_in: tokens.expiresIn,
        },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    } catch (error) {
      console.error('POST /api/oauth/token (refresh) error:', error)
      return oauthError('server_error', '合鍵を付け替えられませんでした', 500)
    }
  }

  return oauthError('unsupported_grant_type', 'grant_type は authorization_code か refresh_token です')
}
