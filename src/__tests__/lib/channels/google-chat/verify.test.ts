// @vitest-environment node
//
// jose の SignJWT/generateKeyPair は WebCrypto を使う。jsdom(既定environment)は独自realmの
// Uint8Array/CryptoKeyを持つため、jose内部の instanceof チェックが失敗する
// （"payload must be an instance of Uint8Array"）。このファイルはネットワーク非依存の
// 純粋なJWT検証ロジックのみを扱うため、node環境に切り替えて realm 不一致を避ける。
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { SignJWT, generateKeyPair, exportJWK, createLocalJWKSet, type JWTVerifyGetKey, type CryptoKey } from 'jose'
import { verifyChatAppRequest } from '@/lib/channels/google-chat/verify'

/**
 * Google Chat app HTTP 入口の Bearer JWT 検証。
 * issuer=chat@system.gserviceaccount.com / audience=GCPプロジェクト番号 / JWKSはGoogle公開の
 * サービスアカウント鍵。実ネットワークは叩かず、jose の SignJWT + ローカル鍵ペアで正当/不正
 * トークンを作り、jwks を注入して検証する。
 */
const ISSUER = 'chat@system.gserviceaccum.test' // 後で正しい issuer 定数を使うテストと分けて確認する
const REAL_ISSUER = 'chat@system.gserviceaccount.com'
const PROJECT_NUMBER = '123456789012'
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
}): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: opts.kid ?? KID })
    .setIssuer(opts.issuer ?? REAL_ISSUER)
    .setAudience(opts.audience ?? PROJECT_NUMBER)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '5m')
    .sign(opts.key ?? privateKey)
}

const ORIGINAL_ENV = process.env.GOOGLE_CHAT_APP_PROJECT_NUMBER

beforeEach(() => {
  process.env.GOOGLE_CHAT_APP_PROJECT_NUMBER = PROJECT_NUMBER
})

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.GOOGLE_CHAT_APP_PROJECT_NUMBER
  else process.env.GOOGLE_CHAT_APP_PROJECT_NUMBER = ORIGINAL_ENV
})

describe('verifyChatAppRequest', () => {
  it('正当なJWT・正しいissuer/audienceは ok:true', async () => {
    const token = await signToken({})
    const result = await verifyChatAppRequest(`Bearer ${token}`, {
      projectNumber: PROJECT_NUMBER,
      jwks,
    })
    expect(result).toMatchObject({ ok: true })
  })

  it('audience違いは invalid', async () => {
    const token = await signToken({ audience: '999999999999' })
    const result = await verifyChatAppRequest(`Bearer ${token}`, {
      projectNumber: PROJECT_NUMBER,
      jwks,
    })
    expect(result).toEqual({ ok: false, reason: 'invalid' })
  })

  it('issuer違いは invalid', async () => {
    const token = await signToken({ issuer: ISSUER })
    const result = await verifyChatAppRequest(`Bearer ${token}`, {
      projectNumber: PROJECT_NUMBER,
      jwks,
    })
    expect(result).toEqual({ ok: false, reason: 'invalid' })
  })

  it('期限切れは invalid', async () => {
    const token = await signToken({ exp: Math.floor(Date.now() / 1000) - 60 })
    const result = await verifyChatAppRequest(`Bearer ${token}`, {
      projectNumber: PROJECT_NUMBER,
      jwks,
    })
    expect(result).toEqual({ ok: false, reason: 'invalid' })
  })

  it('署名不一致（jwksに無い鍵で署名）は invalid', async () => {
    const token = await signToken({ key: otherPrivateKey })
    const result = await verifyChatAppRequest(`Bearer ${token}`, {
      projectNumber: PROJECT_NUMBER,
      jwks,
    })
    expect(result).toEqual({ ok: false, reason: 'invalid' })
  })

  it('トークン無し（Authorizationヘッダ無し）は no_token', async () => {
    const result = await verifyChatAppRequest(null, { projectNumber: PROJECT_NUMBER, jwks })
    expect(result).toEqual({ ok: false, reason: 'no_token' })
  })

  it('Bearer形式でないAuthorizationヘッダは no_token', async () => {
    const result = await verifyChatAppRequest('Basic deadbeef', {
      projectNumber: PROJECT_NUMBER,
      jwks,
    })
    expect(result).toEqual({ ok: false, reason: 'no_token' })
  })

  it('projectNumber未指定かつenv未設定は env_missing', async () => {
    delete process.env.GOOGLE_CHAT_APP_PROJECT_NUMBER
    const token = await signToken({})
    const result = await verifyChatAppRequest(`Bearer ${token}`, { jwks })
    expect(result).toEqual({ ok: false, reason: 'env_missing' })
  })

  it('projectNumber未指定でもenvにあればそれを使う', async () => {
    process.env.GOOGLE_CHAT_APP_PROJECT_NUMBER = PROJECT_NUMBER
    const token = await signToken({})
    const result = await verifyChatAppRequest(`Bearer ${token}`, { jwks })
    expect(result).toMatchObject({ ok: true })
  })
})
