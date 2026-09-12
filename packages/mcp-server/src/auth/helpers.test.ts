import { describe, it, expect, vi } from 'vitest'

/**
 * checkAuthOrg は、org-level ツールをローカルの決まりで断るとき、
 * 決まった日本語で理由を返す（生の英語のまま利用者に届かない）。
 */

vi.mock('../config.js', () => ({
  getAuthContext: () => currentCtx,
}))
vi.mock('./authorize.js', () => ({
  logUsage: async () => {},
}))

let currentCtx: {
  keyId: string
  userId: string | null
  orgId: string
  scope: 'space' | 'org' | 'user'
  allowedSpaceIds: string[] | null
  allowedActions: string[]
}

const { checkAuthOrg } = await import('./helpers.js')

describe('checkAuthOrg — ローカルの断り理由を日本語にする', () => {
  it('scope=org でない鍵はツール名と現在のscopeを含む日本語で断る', async () => {
    currentCtx = { keyId: 'key-1', userId: 'user-1', orgId: 'org-1', scope: 'space', allowedSpaceIds: null, allowedActions: ['read'] }

    const err = await checkAuthOrg('read', 'org_tool').catch((e: unknown) => e)

    expect((err as Error).message).toBe('権限エラー: ツール「org_tool」は scope=org のAPIキーが必要です（現在のscope: space）')
  })

  it('鍵に許可されていない操作は操作名を含む日本語で断る', async () => {
    currentCtx = { keyId: 'key-1', userId: 'user-1', orgId: 'org-1', scope: 'org', allowedSpaceIds: null, allowedActions: ['read'] }

    const err = await checkAuthOrg('write', 'org_tool').catch((e: unknown) => e)

    expect((err as Error).message).toBe('権限エラー: このAPIキーでは操作「write」を実行できません')
  })
})
