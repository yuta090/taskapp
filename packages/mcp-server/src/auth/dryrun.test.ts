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

describe('dryRunDelete / confirmDelete — RPC自体は成功したがsuccess:falseで返す理由も日本語にする', () => {
  it('dryRunDelete: 未対応の対象種別は日本語にする', async () => {
    rpcResponse = {
      data: {
        success: false, affected_count: 0, resource_type: 'unknown', resource_ids: [],
        confirm_token: '', expires_in_seconds: 0, message: '', error: 'Unsupported resource type',
      },
      error: null,
    }

    const result = await dryRunDelete({ ctx: CTX, spaceId: 'space-1', resourceType: 'unknown', resourceIds: ['t-1'] })

    expect(result.error).toBe('指定した対象の種類には対応していません')
  })

  it('confirmDelete: 確認トークンが無効・期限切れ・使用済みは日本語にする', async () => {
    rpcResponse = { data: { success: false, error: 'Invalid, expired, or already used confirm token' }, error: null }

    const result = await confirmDelete({ ctx: CTX, confirmToken: 'token-1' })

    expect(result.error).toBe('確認用のトークンが無効か期限切れ、または既に使われています')
  })
})
