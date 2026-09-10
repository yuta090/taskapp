import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * space_list: プロジェクト設定で作ったキー（scope=space）でも、そのプロジェクト1件を返す。
 * 以前は scope=org/user 以外を断っていたため、画面の案内どおり `agentpm space list` で
 * 接続を確かめると必ず失敗していた（しかも /api/tools で 500 に化けて理由も見えなかった）。
 */
type Ctx = {
  keyId: string
  userId: string | null
  orgId: string
  scope: 'space' | 'org' | 'user'
  spaceId?: string | null
  allowedSpaceIds: string[] | null
  allowedActions: string[]
}

let ctx: Ctx
const filters: Array<[string, string, unknown]> = []
const rows = [{ id: 'space-1', name: 'サンプル商事' }]
const checkAuthMock = vi.fn(async (..._args: unknown[]) => ({ ctx: {} }))

const query = {
  select: () => query,
  eq: (col: string, val: unknown) => { filters.push(['eq', col, val]); return query },
  in: (col: string, val: unknown) => { filters.push(['in', col, val]); return query },
  order: () => query,
  then: (resolve: (v: { data: unknown; error: null }) => unknown) => resolve({ data: rows, error: null }),
}

vi.mock('../config.js', () => ({ config: {}, getAuthContext: () => ctx }))
vi.mock('../supabase/client.js', () => ({ getSupabaseClient: () => ({ from: () => query }) }))
vi.mock('../auth/helpers.js', () => ({
  checkAuth: (...args: unknown[]) => checkAuthMock(...args),
  checkAuthOrg: vi.fn(),
}))

const { spaceList } = await import('./spaces.js')

beforeEach(() => {
  filters.length = 0
  checkAuthMock.mockClear()
})

describe('space_list', () => {
  it('プロジェクト設定で作ったキーなら、そのプロジェクト1件だけを返す', async () => {
    ctx = { keyId: 'k1', userId: 'u1', orgId: 'org-1', scope: 'space', spaceId: 'space-1', allowedSpaceIds: null, allowedActions: ['read'] }

    const result = await spaceList({})

    expect(result).toEqual(rows)
    expect(filters).toContainEqual(['eq', 'id', 'space-1'])
    expect(filters).toContainEqual(['eq', 'org_id', 'org-1'])
  })

  it('そのプロジェクトのメンバーかどうかは、ほかの操作と同じ権限確認を通す', async () => {
    ctx = { keyId: 'k1', userId: 'u1', orgId: 'org-1', scope: 'space', spaceId: 'space-1', allowedSpaceIds: null, allowedActions: ['read'] }
    checkAuthMock.mockRejectedValueOnce(new Error('権限エラー: User is not a member of this space'))

    await expect(spaceList({})).rejects.toThrow('権限エラー: User is not a member of this space')
    expect(checkAuthMock).toHaveBeenCalledWith('space-1', 'read', 'space_list', 'space', 'space-1')
  })

  it('どのプロジェクトのキーか分からなければ断る', async () => {
    ctx = { keyId: 'k1', userId: 'u1', orgId: 'org-1', scope: 'space', spaceId: null, allowedSpaceIds: null, allowedActions: ['read'] }

    await expect(spaceList({})).rejects.toThrow(/^権限エラー:/)
  })

  it('組織全体用のキーは今までどおり組織のプロジェクトを全部返す（1件に絞らない）', async () => {
    ctx = { keyId: 'k2', userId: 'u1', orgId: 'org-1', scope: 'org', allowedSpaceIds: null, allowedActions: ['read'] }

    await spaceList({})

    expect(filters).toContainEqual(['eq', 'org_id', 'org-1'])
    expect(filters.some(([, col]) => col === 'id')).toBe(false)
    expect(checkAuthMock).not.toHaveBeenCalled()
  })
})
