import { describe, it, expect, vi } from 'vitest'

/**
 * dryRunDelete / confirmDelete は、RPC が失敗したとき、決まった日本語を
 * 結果の error に入れる（生のDBの文言は返さず、サーバーの記録にだけ残す）。
 */

let rpcResponse: { data: unknown; error: unknown } = { data: null, error: null }

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({
    rpc: async () => rpcResponse,
  }),
}))

const { dryRunDelete, confirmDelete } = await import('./dryrun.js')

const CTX = { keyId: 'key-1', userId: 'user-1', orgId: 'org-1', scope: 'space' as const, allowedSpaceIds: null, allowedActions: ['delete'] }

describe('dryRunDelete — RPCが失敗したときは決まった日本語を返す', () => {
  it('生のDBの文言は含めない', async () => {
    rpcResponse = { data: null, error: { code: '42501', message: 'permission denied for function mcp_dry_run_delete' } }

    const result = await dryRunDelete({ ctx: CTX, spaceId: 'space-1', resourceType: 'task', resourceIds: ['t-1'] })

    expect(result.success).toBe(false)
    expect(result.error).not.toContain('permission denied')
    expect(result.error).toBeTruthy()
  })
})

describe('confirmDelete — RPCが失敗したときは決まった日本語を返す', () => {
  it('生のDBの文言は含めない', async () => {
    rpcResponse = { data: null, error: { code: '42501', message: 'permission denied for function mcp_confirm_delete' } }

    const result = await confirmDelete({ ctx: CTX, confirmToken: 'token-1' })

    expect(result.success).toBe(false)
    expect(result.error).not.toContain('permission denied')
    expect(result.error).toBeTruthy()
  })
})
