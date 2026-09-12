import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * dispatchTool は、認証直後（ハンドラ実行前）に、この呼び出し自身の ctx/spaceId を
 * onAuthenticated で報告する。呼び出し元（/api/tools）が利用記録にそのまま使えるように。
 */

let authCtx = { keyId: 'key-1', userId: 'user-1', orgId: 'org-1', scope: 'org' as const, allowedSpaceIds: null, allowedActions: ['read', 'write'] as const }
let handlerImpl: (params: unknown) => Promise<unknown> = async () => ({ ok: true })

vi.mock('./config.js', () => ({
  initializeAuthWithApiKey: vi.fn(async () => {}),
  getAuthContext: () => authCtx,
}))

vi.mock('./tools/index.js', () => ({
  allTools: [
    {
      name: 'fake_tool',
      inputSchema: { parse: (p: unknown) => p },
      handler: (p: unknown) => handlerImpl(p),
    },
  ],
}))

const { dispatchTool } = await import('./dispatch.js')

beforeEach(() => {
  authCtx = { keyId: 'key-1', userId: 'user-1', orgId: 'org-1', scope: 'org', allowedSpaceIds: null, allowedActions: ['read', 'write'] }
  handlerImpl = async () => ({ ok: true })
})

describe('dispatchTool — onAuthenticated', () => {
  it('認証したctxと、paramsのspaceIdを報告する', async () => {
    const reported: unknown[] = []
    await dispatchTool('api-key', 'fake_tool', { spaceId: 'space-1' }, (info) => reported.push(info))

    expect(reported).toEqual([{ keyId: 'key-1', orgId: 'org-1', userId: 'user-1', spaceId: 'space-1' }])
  })

  it('paramsにspaceIdが無ければ null を報告する', async () => {
    const reported: unknown[] = []
    await dispatchTool('api-key', 'fake_tool', {}, (info) => reported.push(info))

    expect(reported).toEqual([{ keyId: 'key-1', orgId: 'org-1', userId: 'user-1', spaceId: null }])
  })

  it('ハンドラが失敗しても、その前に報告済みのctxは呼び出し元に残る', async () => {
    handlerImpl = async () => {
      throw new Error('boom')
    }
    const reported: unknown[] = []

    await expect(
      dispatchTool('api-key', 'fake_tool', { spaceId: 'space-1' }, (info) => reported.push(info))
    ).rejects.toThrow('boom')

    expect(reported).toEqual([{ keyId: 'key-1', orgId: 'org-1', userId: 'user-1', spaceId: 'space-1' }])
  })

  it('onAuthenticated を渡さなくても従来どおり動く', async () => {
    const result = await dispatchTool('api-key', 'fake_tool', {})
    expect(result).toEqual({ ok: true })
  })
})
