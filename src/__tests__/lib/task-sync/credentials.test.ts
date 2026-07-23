import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 資格情報の解決。OAuth（期限あり・refreshあり）と APIキー/PAT（期限なし・refreshなし）の
 * 寿命管理の違いを1箇所で吸収していることを固定する。
 *
 * 特に重要な回帰:
 *   1) **APIキー接続を refresh 経路に流さない**こと。流すと外部の 400 応答を「失効」と誤判定して、
 *      正常な接続を expired 化してしまう。
 *   2) **更新不能な OAuth（refresh_token が無い。Notion のワークスペーストークン等）を
 *      refreshFn 必須のまま扱わない**こと。従来は auth_kind==='oauth' なら常に refreshFn を
 *      要求しており、refresh_token を持たない OAuth 接続（Notion）が refreshFn を渡されないまま
 *      呼ばれる経路（runner.ts）と組み合わさって、常に misconfigured skip され一度も取り込みが
 *      実行されない断線を起こしていた。判定は「refresh_token(_encrypted) の有無」という事実だけで
 *      行い、refresh_token を**持つ**既存の更新可能OAuth（Google系）の挙動は一切変えない。
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

describe('resolveCredentials — OAuth（refresh_token あり＝更新可能。Google系の既存挙動）', () => {
  it('token-manager が返した有効トークンをそのまま渡す', async () => {
    getValidTokenDetailed.mockResolvedValue({ status: 'ok', token: 'fresh-token' })
    const res = await resolveCredentials(
      { id: 'c1', auth_kind: 'oauth', base_url: null, access_token_encrypted: 'enc', refresh_token_encrypted: 'enc-refresh' },
      refreshFn,
    )
    expect(res).toEqual({
      status: 'ok',
      credentials: { kind: 'oauth', token: 'fresh-token', baseUrl: null },
    })
    expect(getValidTokenDetailed).toHaveBeenCalledWith('c1', refreshFn)
  })

  it('失効(auth_failed)と一時障害(transient_error)の区別を作り直さず素通しする', async () => {
    getValidTokenDetailed.mockResolvedValue({ status: 'auth_failed' })
    expect(
      await resolveCredentials(
        { id: 'c1', auth_kind: 'oauth', base_url: null, access_token_encrypted: 'enc', refresh_token_encrypted: 'enc-refresh' },
        refreshFn,
      ),
    ).toEqual({ status: 'auth_failed' })

    getValidTokenDetailed.mockResolvedValue({ status: 'transient_error' })
    expect(
      await resolveCredentials(
        { id: 'c1', auth_kind: 'oauth', base_url: null, access_token_encrypted: 'enc', refresh_token_encrypted: 'enc-refresh' },
        refreshFn,
      ),
    ).toEqual({ status: 'transient_error' })
  })

  it('refresh_token を持つのに refreshFn が渡されなければ配線ミスとして設定不備にする（再試行しない・既存挙動の固定）', async () => {
    const res = await resolveCredentials({
      id: 'c1',
      auth_kind: 'oauth',
      base_url: null,
      access_token_encrypted: 'enc',
      refresh_token_encrypted: 'enc-refresh',
    })
    expect(res.status).toBe('misconfigured')
    expect(getValidTokenDetailed).not.toHaveBeenCalled()
  })

  it('平文列(refresh_token)しか無くても「refresh可能」と判定する（移行期のフォールバック）', async () => {
    getValidTokenDetailed.mockResolvedValue({ status: 'ok', token: 'fresh-token' })
    const res = await resolveCredentials(
      { id: 'c1', auth_kind: 'oauth', base_url: null, access_token_encrypted: 'enc', refresh_token: 'plain-refresh' },
      refreshFn,
    )
    expect(res.status).toBe('ok')
    expect(getValidTokenDetailed).toHaveBeenCalledWith('c1', refreshFn)
  })
})

describe('resolveCredentials — OAuth（refresh_token 無し＝更新不能。Notion等の無期限トークン）', () => {
  it('refreshFn が無くても復号だけで解決できる（本丸の回帰: Notion接続が一度も取り込まれない断線の修正）', async () => {
    decryptToken.mockResolvedValue('notion-workspace-token')
    const res = await resolveCredentials({
      id: 'c1',
      auth_kind: 'oauth',
      base_url: null,
      access_token_encrypted: 'enc',
      refresh_token_encrypted: null,
      refresh_token: null,
    })
    expect(res).toEqual({
      status: 'ok',
      credentials: { kind: 'oauth', token: 'notion-workspace-token', baseUrl: null },
    })
    expect(getValidTokenDetailed).not.toHaveBeenCalled()
  })

  it('refresh_token 列が select 自体に含まれない（undefined）ときも更新不能として同じく解決できる', async () => {
    decryptToken.mockResolvedValue('notion-workspace-token')
    const res = await resolveCredentials({
      id: 'c1',
      auth_kind: 'oauth',
      base_url: null,
      access_token_encrypted: 'enc',
    })
    expect(res.status).toBe('ok')
    expect(getValidTokenDetailed).not.toHaveBeenCalled()
  })

  it('access_token_encrypted が復号できなければ設定不備（再試行では直らない）', async () => {
    decryptToken.mockResolvedValue(null)
    const res = await resolveCredentials({
      id: 'c1',
      auth_kind: 'oauth',
      base_url: null,
      access_token_encrypted: null,
      refresh_token_encrypted: null,
    })
    expect(res.status).toBe('misconfigured')
    expect(getValidTokenDetailed).not.toHaveBeenCalled()
  })

  it('【回帰】復号が throw（一時障害）なら transient_error にする（misconfigured で恒久失敗にしない）', async () => {
    decryptToken.mockRejectedValue(new Error('decrypt_system_secret failed'))
    const res = await resolveCredentials({
      id: 'c1',
      auth_kind: 'oauth',
      base_url: null,
      access_token_encrypted: 'enc',
      refresh_token_encrypted: null,
    })
    expect(res.status).toBe('transient_error')
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

  it('復号できない鍵は設定不備（error無し・data無し＝恒久破損）。再試行では直らない', async () => {
    decryptToken.mockResolvedValue(null)
    const res = await resolveCredentials({
      id: 'c1',
      auth_kind: 'api_key',
      base_url: null,
      access_token_encrypted: null,
    })
    expect(res.status).toBe('misconfigured')
  })

  it('【回帰】復号が throw（一時障害）なら transient_error にする（misconfigured にしない）', async () => {
    decryptToken.mockRejectedValue(new Error('decrypt_system_secret failed'))
    const res = await resolveCredentials({
      id: 'c1',
      auth_kind: 'api_key',
      base_url: null,
      access_token_encrypted: 'enc',
    })
    expect(res.status).toBe('transient_error')
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
