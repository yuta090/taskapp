import { describe, it, expect, vi, beforeEach } from 'vitest'
import { hashSecret, newOAuthToken } from '@/lib/mcp/oauth/secrets'

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
    const token = newOAuthToken()
    oauthTokens.set(hashSecret(token), { orgId: 'org-oauth' })

    const ctx = await resolveApiKey(token)
    expect(ctx.keyId).toBe('k-oauth')
    expect(ctx.orgId).toBe('org-oauth')
  })

  it('目印が無ければ、合鍵の表は引かずにAPIキーとして扱う', async () => {
    apiKeys.set('tsk_live_abcdef', { orgId: 'org-api' })

    const ctx = await resolveApiKey('tsk_live_abcdef')
    expect(ctx.keyId).toBe('k-api')
    expect(ctx.orgId).toBe('org-api')
  })

  it('どちらでもなければ失敗する（黙って通さない）', async () => {
    await expect(resolveApiKey('知らない値')).rejects.toThrow()
  })

  it('目印だけ真似ても、控えが合わなければ通らない（目印は権限ではない）', async () => {
    await expect(resolveApiKey(newOAuthToken())).rejects.toThrow()
  })

  it('目印を付けた値は、APIキーとしては引き直さない（取り違えを作らない）', async () => {
    const fake = newOAuthToken()
    apiKeys.set(fake, { orgId: 'org-api' })
    await expect(resolveApiKey(fake)).rejects.toThrow()
  })
})
