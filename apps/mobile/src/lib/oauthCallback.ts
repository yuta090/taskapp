/**
 * Google ログインのあと、ブラウザからアプリに戻ってきた URL（agentpm://auth/callback?...）を読む。
 * PKCE なので、成功すれば認可コード（code）だけが来る。アプリはそれを Supabase でセッションに換える。
 */
export type OAuthCallbackResult = { code: string } | { error: string }

export function parseOAuthCallback(url: string): OAuthCallbackResult {
  const params = new URLSearchParams()
  const queryStart = url.indexOf('?')
  const hashStart = url.indexOf('#')
  const query = queryStart >= 0 ? url.slice(queryStart + 1, hashStart > queryStart ? hashStart : undefined) : ''
  const hash = hashStart >= 0 ? url.slice(hashStart + 1) : ''
  for (const part of [query, hash]) {
    new URLSearchParams(part).forEach((value, key) => params.set(key, value))
  }

  const error = params.get('error')
  if (error) return { error: params.get('error_description') || error }
  const code = params.get('code')
  if (code) return { code }
  return { error: 'ログインの結果を受け取れませんでした' }
}
