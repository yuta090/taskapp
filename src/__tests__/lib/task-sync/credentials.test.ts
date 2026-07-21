import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 資格情報の解決。OAuth（期限あり・refreshあり）と APIキー/PAT（期限なし・refreshなし）の
 * 寿命管理の違いを1箇所で吸収していることを固定する。
 *
 * 特に重要な回帰: **APIキー接続を refresh 経路に流さない**こと。流すと外部の 400 応答を
 * 「失効」と誤判定して、正常な接続を expired 化してしまう。
 */

const getValidTokenDetailed = vi.fn()
const decryptToken = vi.fn()

vi.mock('@/lib/integrations/token-manager', () => ({
  getValidTokenDetailed: (...args: unknown[]) => getValidTokenDetailed(...args),
}))
vi.mock('@/lib/integrations/token-crypto', () => ({
  decryptToken: (...args: unknown[]) => decryptToken(...args),
}))

const { resolveCredentials } = await import('@/lib/task-sync/credentials')

const refreshFn = vi.fn()

beforeEach(() => {
  getValidTokenDetailed.mockReset()
  decryptToken.mockReset()
})

describe('resolveCredentials — OAuth', () => {
  it('token-manager が返した有効トークンをそのまま渡す', async () => {
    getValidTokenDetailed.mockResolvedValue({ status: 'ok', token: 'fresh-token' })
    const res = await resolveCredentials(
      { id: 'c1', auth_kind: 'oauth', base_url: null, access_token_encrypted: 'enc' },
      refreshFn,
    )
    expect(res).toEqual({
      status: 'ok',
      credentials: { kind: 'oauth', token: 'fresh-token', baseUrl: null },
    })
  })

  it('失効(auth_failed)と一時障害(transient_error)の区別を作り直さず素通しする', async () => {
    getValidTokenDetailed.mockResolvedValue({ status: 'auth_failed' })
    expect(
      await resolveCredentials(
        { id: 'c1', auth_kind: 'oauth', base_url: null, access_token_encrypted: 'enc' },
        refreshFn,
      ),
    ).toEqual({ status: 'auth_failed' })

    getValidTokenDetailed.mockResolvedValue({ status: 'transient_error' })
    expect(
      await resolveCredentials(
        { id: 'c1', auth_kind: 'oauth', base_url: null, access_token_encrypted: 'enc' },
        refreshFn,
      ),
    ).toEqual({ status: 'transient_error' })
  })

  it('refresh 手段が無いOAuth接続は配線ミスとして設定不備にする（再試行しない）', async () => {
    const res = await resolveCredentials({
      id: 'c1',
      auth_kind: 'oauth',
      base_url: null,
      access_token_encrypted: 'enc',
    })
    expect(res.status).toBe('misconfigured')
    expect(getValidTokenDetailed).not.toHaveBeenCalled()
  })
})

describe('resolveCredentials — APIキー/PAT', () => {
  it('暗号化列を復号して渡す。baseUrl も一緒に運ぶ', async () => {
    decryptToken.mockResolvedValue('plain-api-key')
    const res = await resolveCredentials({
      id: 'c1',
      auth_kind: 'api_key',
      base_url: 'https://example.backlog.jp',
      access_token_encrypted: 'enc',
    })
    expect(res).toEqual({
      status: 'ok',
      credentials: { kind: 'api_key', token: 'plain-api-key', baseUrl: 'https://example.backlog.jp' },
    })
  })

  it('APIキー接続を refresh 経路に流さない（正常な接続を失効扱いにしないための回帰）', async () => {
    decryptToken.mockResolvedValue('plain-api-key')
    await resolveCredentials(
      { id: 'c1', auth_kind: 'api_key', base_url: null, access_token_encrypted: 'enc' },
      refreshFn,
    )
    expect(getValidTokenDetailed).not.toHaveBeenCalled()
    expect(refreshFn).not.toHaveBeenCalled()
  })

  it('復号できない鍵は設定不備（鍵ローテ・空・不正blob）。再試行では直らない', async () => {
    decryptToken.mockResolvedValue(null)
    const res = await resolveCredentials({
      id: 'c1',
      auth_kind: 'api_key',
      base_url: null,
      access_token_encrypted: null,
    })
    expect(res.status).toBe('misconfigured')
  })
})

describe('resolveCredentials — 対象外', () => {
  it('shared_secret(multica)はタスク同期の資格情報ではないため設定不備にする', async () => {
    const res = await resolveCredentials({
      id: 'c1',
      auth_kind: 'shared_secret',
      base_url: 'https://multica.example.com',
      access_token_encrypted: null,
    })
    expect(res.status).toBe('misconfigured')
  })
})
