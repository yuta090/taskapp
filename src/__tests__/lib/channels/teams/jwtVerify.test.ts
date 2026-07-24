// @vitest-environment node
//
// jose の SignJWT/generateKeyPair は WebCrypto を使う。jsdom(既定environment)は独自realmの
// Uint8Array/CryptoKeyを持つため、jose内部の instanceof チェックが失敗する
// （"payload must be an instance of Uint8Array"）。このファイルはネットワーク非依存の
// 純粋なJWT検証ロジックのみを扱うため、node環境に切り替えて realm 不一致を避ける
// （google-chat/verify.test.ts と同じ手法）。
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet, type JWTVerifyGetKey, type CryptoKey } from 'jose'
import { verifyTeamsActivityRequest } from '@/lib/channels/teams/jwtVerify'

const ISSUER = 'https://sts.windows.net/tenant/' // 不正issuerケース用
const REAL_ISSUER = 'https://api.botframework.com'
const APP_ID = '00000000-0000-0000-0000-000000000001'
const SERVICE_URL = 'https://smba.trafficmanager.net/amer/'
const KID = 'test-kid'

let jwks: JWTVerifyGetKey
let privateKey: CryptoKey
let otherPrivateKey: CryptoKey

beforeAll(async () => {
  const pair = await generateKeyPair('RS256')
  privateKey = pair.privateKey
  const jwk = await exportJWK(pair.publicKey)
  jwk.kid = KID
  jwk.alg = 'RS256'
  jwks = createLocalJWKSet({ keys: [jwk] })

  // jwks に登録されていない鍵（署名不一致ケース用）
  const other = await generateKeyPair('RS256')
  otherPrivateKey = other.privateKey
})

async function signToken(opts: {
  issuer?: string
  audience?: string
  exp?: number | string
  key?: CryptoKey
  kid?: string
  serviceurl?: string | null
}): Promise<string> {
  const claims: Record<string, unknown> = {}
  if (opts.serviceurl !== null) {
    claims.serviceurl = opts.serviceurl ?? SERVICE_URL
  }
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: opts.kid ?? KID })
    .setIssuer(opts.issuer ?? REAL_ISSUER)
    .setAudience(opts.audience ?? APP_ID)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '5m')
    .sign(opts.key ?? privateKey)
}

const ORIGINAL_ENV = process.env.TEAMS_BOT_APP_ID

beforeEach(() => {
  process.env.TEAMS_BOT_APP_ID = APP_ID
})

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.TEAMS_BOT_APP_ID
  else process.env.TEAMS_BOT_APP_ID = ORIGINAL_ENV
})

describe('verifyTeamsActivityRequest', () => {
  it('正当なJWT・正しいissuer/audience・serviceurl一致は ok:true', async () => {
    const token = await signToken({})
    const result = await verifyTeamsActivityRequest(`Bearer ${token}`, SERVICE_URL, {
      appId: APP_ID,
      jwks,
    })
    expect(result).toEqual({ ok: true })
  })

  it('audience違いは invalid', async () => {
    const token = await signToken({ audience: '99999999-0000-0000-0000-000000000000' })
    const result = await verifyTeamsActivityRequest(`Bearer ${token}`, SERVICE_URL, {
      appId: APP_ID,
      jwks,
    })
    expect(result).toEqual({ ok: false, reason: 'invalid' })
  })

  it('issuer違いは invalid', async () => {
    const token = await signToken({ issuer: ISSUER })
    const result = await verifyTeamsActivityRequest(`Bearer ${token}`, SERVICE_URL, {
      appId: APP_ID,
      jwks,
    })
    expect(result).toEqual({ ok: false, reason: 'invalid' })
  })

  it('期限切れは invalid', async () => {
    const token = await signToken({ exp: Math.floor(Date.now() / 1000) - 60 })
    const result = await verifyTeamsActivityRequest(`Bearer ${token}`, SERVICE_URL, {
      appId: APP_ID,
      jwks,
    })
    expect(result).toEqual({ ok: false, reason: 'invalid' })
  })

  it('署名不一致（jwksに無い鍵で署名）は invalid', async () => {
    const token = await signToken({ key: otherPrivateKey })
    const result = await verifyTeamsActivityRequest(`Bearer ${token}`, SERVICE_URL, {
      appId: APP_ID,
      jwks,
    })
    expect(result).toEqual({ ok: false, reason: 'invalid' })
  })

  it('★SSRF防御: JWTのserviceurlクレームとactivity.serviceUrlが不一致は invalid', async () => {
    const token = await signToken({ serviceurl: SERVICE_URL })
    const result = await verifyTeamsActivityRequest(
      `Bearer ${token}`,
      'https://evil.example.com/steal',
      { appId: APP_ID, jwks },
    )
    expect(result).toEqual({ ok: false, reason: 'invalid' })
  })

  it('serviceurlクレームが無いトークンは invalid（activity.serviceUrlが与えられていても）', async () => {
    const token = await signToken({ serviceurl: null })
    const result = await verifyTeamsActivityRequest(`Bearer ${token}`, SERVICE_URL, {
      appId: APP_ID,
      jwks,
    })
    expect(result).toEqual({ ok: false, reason: 'invalid' })
  })

  it('activity.serviceUrlが未提供（null/undefined）は invalid', async () => {
    const token = await signToken({})
    const result = await verifyTeamsActivityRequest(`Bearer ${token}`, null, {
      appId: APP_ID,
      jwks,
    })
    expect(result).toEqual({ ok: false, reason: 'invalid' })
  })

  it('トークン無し（Authorizationヘッダ無し）は no_token', async () => {
    const result = await verifyTeamsActivityRequest(null, SERVICE_URL, { appId: APP_ID, jwks })
    expect(result).toEqual({ ok: false, reason: 'no_token' })
  })

  it('Bearer形式でないAuthorizationヘッダは no_token', async () => {
    const result = await verifyTeamsActivityRequest('Basic deadbeef', SERVICE_URL, {
      appId: APP_ID,
      jwks,
    })
    expect(result).toEqual({ ok: false, reason: 'no_token' })
  })

  it('appId未指定かつenv未設定は env_missing', async () => {
    delete process.env.TEAMS_BOT_APP_ID
    const token = await signToken({})
    const result = await verifyTeamsActivityRequest(`Bearer ${token}`, SERVICE_URL, { jwks })
    expect(result).toEqual({ ok: false, reason: 'env_missing' })
  })

  it('appId未指定でもenvにあればそれを使う', async () => {
    process.env.TEAMS_BOT_APP_ID = APP_ID
    const token = await signToken({})
    const result = await verifyTeamsActivityRequest(`Bearer ${token}`, SERVICE_URL, { jwks })
    expect(result).toEqual({ ok: true })
  })
})
