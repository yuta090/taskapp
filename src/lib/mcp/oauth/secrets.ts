import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * 引換券・合鍵の作り方と控えの取り方。
 *
 * ⚠ 生の文字列は絶対に保存しない。DB に入れるのは SHA-256 の控えだけ。
 * 漏れたときに、DB を見ただけでは他人になりすませないようにするため。
 * （api_keys の key_hash と同じ考え方）
 */

/** 合鍵の寿命。短くして、漏れたときの有効時間を絞る */
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60 // 1時間
/** 付け替え用。使うたびに新しいものに差し替える */
export const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30 // 30日
/** 引換券。同意画面からつなぎ先に渡るまでの間だけ */
export const AUTHORIZATION_CODE_TTL_SECONDS = 5 * 60 // 5分

/** 推測できない文字列を作る（32バイト = 256ビット） */
export function newSecret(): string {
  return randomBytes(32).toString('base64url')
}

/** DB に入れる控え */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

/** 控え同士を、長さの違いだけで中身を推測されない形で比べる */
export function secretsMatch(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

/**
 * 登録元の目印。IP そのものは保存しない（個人に結びつく情報を残さない）。
 * 同じ相手からの登録を数えるためだけに使う。
 */
export function hashClientIp(ip: string | null): string | null {
  if (!ip) return null
  const salt = process.env.OAUTH_IP_HASH_SALT || 'agentpm-oauth'
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex')
}

/** 今から n 秒後 */
export function expiresAt(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString()
}
