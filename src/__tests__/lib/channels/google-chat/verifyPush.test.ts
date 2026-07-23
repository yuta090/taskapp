// @vitest-environment node
//
// jose の SignJWT/generateKeyPair は WebCrypto を使う。jsdom(既定environment)は独自realmの
// Uint8Array/CryptoKeyを持つため、jose内部の instanceof チェックが失敗する
// （verify.test.ts と同じ理由でnode環境に切り替える）。
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet, type JWTVerifyGetKey, type CryptoKey } from 'jose'
import { verifyPushRequest } from '@/lib/channels/google-chat/verifyPush'

/**
 * Cloud Pub/Sub push（Workspace Events API 経由の全メッセージ配送）の OIDC JWT 検証。
 * issuer=https://accounts.google.com / audience=push endpoint URL / email=Pub/Sub push用SA /
 * email_verified=true / JWKS=Google公開鍵。4点全一致・fail-closed（Fable裁定）。
 * 実ネットワークは叩かず、jose の SignJWT + ローカル鍵ペアで正当/不正トークンを作り、
 * jwks を注入して検証する。
 */
const REAL_ISSUER = 'https://accounts.google.com'
const AUDIENCE = 'https://app.example.com/api/channels/google-chat/ingest'
const SA_EMAIL = 'pubsub-push@example-project.iam.gserviceaccount.com'
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

  const other = await generateKeyPair('RS256')
  otherPrivateKey = other.privateKey
})

async function signToken(opts: {
  issuer?: string
  audience?: string
  email?: string
  emailVerified?: boolean
  exp?: number | string
  key?: CryptoKey
  kid?: string
}): Promise<string> {
  return new SignJWT({
    email: opts.email ?? SA_EMAIL,
    email_verified: opts.emailVerified ?? true,
  })
    .setProtectedHeader({ alg: 'RS256', kid: opts.kid ?? KID })
    .setIssuer(opts.issuer ?? REAL_ISSUER)
    .setAudience(opts.audience ?? AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '5m')
    .sign(opts.key ?? privateKey)
}

const ORIGINAL_AUDIENCE = process.env.GOOGLE_CHAT_PUSH_AUDIENCE
const ORIGINAL_SA_EMAIL = process.env.GOOGLE_CHAT_PUSH_SA_EMAIL

beforeEach(() => {
  process.env.GOOGLE_CHAT_PUSH_AUDIENCE = AUDIENCE
  process.env.GOOGLE_CHAT_PUSH_SA_EMAIL = SA_EMAIL
})

afterEach(() => {
  if (ORIGINAL_AUDIENCE === undefined) delete process.env.GOOGLE_CHAT_PUSH_AUDIENCE
  else process.env.GOOGLE_CHAT_PUSH_AUDIENCE = ORIGINAL_AUDIENCE
  if (ORIGINAL_SA_EMAIL === undefined) delete process.env.GOOGLE_CHAT_PUSH_SA_EMAIL
  else process.env.GOOGLE_CHAT_PUSH_SA_EMAIL = ORIGINAL_SA_EMAIL
})

describe('verifyPushRequest', () => {
  it('正当なOIDC(issuer/audience/email/email_verified全一致)は ok:true', async () => {
    const token = await signToken({})
    const result = await verifyPushRequest(`Bearer ${token}`, { audience: AUDIENCE, serviceAccountEmail: SA_EMAIL, jwks })
    expect(result).toEqual({ ok: true })
  })

  it('audience違いは invalid', async () => {
    const token = await signToken({ audience: 'https://other.example.com/ingest' })
    const result = await verifyPushRequest(`Bearer ${token}`, { audience: AUDIENCE, serviceAccountEmail: SA_EMAIL, jwks })
    expect(result).toEqual({ ok: false, reason: 'invalid' })
  })

  it('issuer違いは invalid', async () => {
    const token = await signToken({ issuer: 'https://evil.example.com' })
    const result = await verifyPushRequest(`Bearer ${token}`, { audience: AUDIENCE, serviceAccountEmail: SA_EMAIL, jwks })
    expect(result).toEqual({ ok: false, reason: 'invalid' })
  })

  it('issuer=accounts.google.com（httpsスキーム無し）も許容する', async () => {
    const token = await signToken({ issuer: 'accounts.google.com' })
    const result = await verifyPushRequest(`Bearer ${token}`, { audience: AUDIENCE, serviceAccountEmail: SA_EMAIL, jwks })
    expect(result).toEqual({ ok: true })
  })

  it('email違いは invalid', async () => {
    const token = await signToken({ email: 'someone-else@example.com' })
    const result = await verifyPushRequest(`Bearer ${token}`, { audience: AUDIENCE, serviceAccountEmail: SA_EMAIL, jwks })
    expect(result).toEqual({ ok: false, reason: 'invalid' })
  })

  it('email_verified=false は invalid', async () => {
    const token = await signToken({ emailVerified: false })
    const result = await verifyPushRequest(`Bearer ${token}`, { audience: AUDIENCE, serviceAccountEmail: SA_EMAIL, jwks })
    expect(result).toEqual({ ok: false, reason: 'invalid' })
  })

  it('期限切れは invalid', async () => {
    const token = await signToken({ exp: Math.floor(Date.now() / 1000) - 60 })
    const result = await verifyPushRequest(`Bearer ${token}`, { audience: AUDIENCE, serviceAccountEmail: SA_EMAIL, jwks })
    expect(result).toEqual({ ok: false, reason: 'invalid' })
  })

  it('署名不一致（jwksに無い鍵で署名）は invalid', async () => {
    const token = await signToken({ key: otherPrivateKey })
    const result = await verifyPushRequest(`Bearer ${token}`, { audience: AUDIENCE, serviceAccountEmail: SA_EMAIL, jwks })
    expect(result).toEqual({ ok: false, reason: 'invalid' })
  })

  it('トークン無し（Authorizationヘッダ無し）は no_token', async () => {
    const result = await verifyPushRequest(null, { audience: AUDIENCE, serviceAccountEmail: SA_EMAIL, jwks })
    expect(result).toEqual({ ok: false, reason: 'no_token' })
  })

  it('Bearer形式でないAuthorizationヘッダは no_token', async () => {
    const result = await verifyPushRequest('Basic deadbeef', { audience: AUDIENCE, serviceAccountEmail: SA_EMAIL, jwks })
    expect(result).toEqual({ ok: false, reason: 'no_token' })
  })

  it('audience未指定かつenv未設定は env_missing', async () => {
    delete process.env.GOOGLE_CHAT_PUSH_AUDIENCE
    const token = await signToken({})
    const result = await verifyPushRequest(`Bearer ${token}`, { serviceAccountEmail: SA_EMAIL, jwks })
    expect(result).toEqual({ ok: false, reason: 'env_missing' })
  })

  it('serviceAccountEmail未指定かつenv未設定は env_missing', async () => {
    delete process.env.GOOGLE_CHAT_PUSH_SA_EMAIL
    const token = await signToken({})
    const result = await verifyPushRequest(`Bearer ${token}`, { audience: AUDIENCE, jwks })
    expect(result).toEqual({ ok: false, reason: 'env_missing' })
  })

  it('audience/serviceAccountEmail未指定でもenvにあればそれを使う', async () => {
    const token = await signToken({})
    const result = await verifyPushRequest(`Bearer ${token}`, { jwks })
    expect(result).toEqual({ ok: true })
  })
})
