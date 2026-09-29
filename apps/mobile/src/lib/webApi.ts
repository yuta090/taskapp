/**
 * Web のサーバー API を呼ぶリクエストを組み立てる。ログインのアクセストークンは Bearer で付ける
 * （サーバー側は src/lib/supabase/routeAuth.ts で確かめる）。
 * トークンを平文の通信に載せないよう、https 以外には送らない（開発中の localhost だけ例外）。
 */
export interface WebApiRequest {
  url: string
  init: { method: 'POST'; headers: Record<string, string>; body: string }
}

function isAllowedBase(url: URL): boolean {
  if (url.protocol === 'https:') return true
  return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
}

export function buildWebApiRequest(
  baseUrl: string,
  path: string,
  accessToken: string | null,
  body: unknown
): WebApiRequest {
  const base = new URL(baseUrl)
  if (!isAllowedBase(base)) throw new Error('Web の URL は https にしてください')
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`
  return {
    url: `${baseUrl.replace(/\/+$/, '')}${path}`,
    init: { method: 'POST', headers, body: JSON.stringify(body) },
  }
}
