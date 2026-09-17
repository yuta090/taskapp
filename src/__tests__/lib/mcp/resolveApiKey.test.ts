import { describe, it, expect, vi, beforeEach } from 'vitest'
import { hashSecret } from '@/lib/mcp/oauth/secrets'

/**
 * /api/mcp に来た Bearer を1本に解決する。
 *
 * ⚠ 合鍵（OAuth）とAPIキーは別物として引く。合鍵の控えは api_keys の key_hash とは
 * 突き合わせない。そうしないと、外部チャットに出した合鍵が CLI（/api/tools・全67ツール）
 * でも通ってしまう。
 */

const oauthTokens = new Map<string, { orgId: string }>()
const apiKeys = new Map<string, { orgId: string }>()

vi.mock('agentpm-core/dist/config.js', () => ({
  resolveAuthContextFromOAuthToken: async (tokenHash: string) => {
    const row = oauthTokens.get(tokenHash)
    if (!row) throw new Error('APIキーが無効か期限切れです')
    return { keyId: 'k-oauth', userId: 'u', orgId: row.orgId, scope: 'user', allowedSpaceIds: null, allowedActions: ['read'] }
  },
  resolveAuthContext: async (raw: string) => {
    const row = apiKeys.get(raw)
    if (!row) throw new Error('APIキーが無効か期限切れです')
    return { keyId: 'k-api', userId: 'u', orgId: row.orgId, scope: 'org', allowedSpaceIds: null, allowedActions: ['read', 'write'] }
  },
}))

const { resolveApiKey } = await import('@/lib/mcp/resolveApiKey')

beforeEach(() => {
  oauthTokens.clear()
  apiKeys.clear()
})

describe('resolveApiKey', () => {
  it('OAuth の合鍵を、控えで引き当てる', async () => {
    oauthTokens.set(hashSecret('oauth-token-abc'), { orgId: 'org-oauth' })

    const ctx = await resolveApiKey('oauth-token-abc')
    expect(ctx.keyId).toBe('k-oauth')
    expect(ctx.orgId).toBe('org-oauth')
  })

  it('合鍵でなければ、APIキーとして引き直す', async () => {
    apiKeys.set('tsk_live_abcdef', { orgId: 'org-api' })

    const ctx = await resolveApiKey('tsk_live_abcdef')
    expect(ctx.keyId).toBe('k-api')
    expect(ctx.orgId).toBe('org-api')
  })

  it('どちらでもなければ失敗する（黙って通さない）', async () => {
    await expect(resolveApiKey('知らない値')).rejects.toThrow()
  })

  it('APIキーの生の値を合鍵として渡しても、合鍵側では引き当たらない', async () => {
    apiKeys.set('tsk_live_abcdef', { orgId: 'org-api' })
    // 合鍵の表には入っていないので、APIキーとして解決される（＝権限はAPIキーのもの）
    const ctx = await resolveApiKey('tsk_live_abcdef')
    expect(ctx.keyId).toBe('k-api')
  })
})
