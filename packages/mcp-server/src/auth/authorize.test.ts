import { describe, it, expect, vi } from 'vitest'

/**
 * authorize は、mcp_authorize 自体が失敗したとき、reason に決まった日本語を入れる
 * （「権限エラー: 」で始まる文言は呼んだ人にそのまま返る決まりなので、DBの生の文言を混ぜない）。
 */

let rpcResponse: { data: unknown; error: unknown } = { data: null, error: null }

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({
    rpc: async () => rpcResponse,
  }),
}))

const { authorize } = await import('./authorize.js')

const CTX = {
  keyId: 'key-1',
  userId: 'user-1',
  orgId: 'org-1',
  scope: 'space' as const,
  allowedSpaceIds: null,
  allowedActions: ['read', 'write'] as const,
}

describe('authorize — mcp_authorize自体が失敗したときは決まった日本語を返す', () => {
  it('reasonに生のDBの文言を含めない', async () => {
    rpcResponse = { data: null, error: { code: '42501', message: 'permission denied for function mcp_authorize' } }

    const result = await authorize({
      ctx: CTX as never,
      spaceId: 'space-1',
      action: 'read',
    })

    expect(result.allowed).toBe(false)
    expect(result.reason).not.toContain('permission denied')
    expect(result.reason).toBeTruthy()
  })
})
