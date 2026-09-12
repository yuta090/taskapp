import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * space_list: プロジェクト設定で作ったキー（scope=space）でも、そのプロジェクト1件を返す。
 * 画面の案内どおり `agentpm space list` で接続を確かめられる。
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
/** 個人用の鍵の持ち主が今所属しているプロジェクト（space_memberships の問い合わせ結果） */
let memberships: Array<{ space_id: string }> = []
const membershipsQuery = {
  select: () => membershipsQuery,
  eq: () => membershipsQuery,
  then: (resolve: (v: { data: unknown; error: null }) => unknown) => resolve({ data: memberships, error: null }),
}
const authorizeMock = vi.fn(async (_args: { spaceId: string }) => ({ allowed: true }))

vi.mock('../supabase/client.js', () => ({
  getSupabaseClient: () => ({ from: (table: string) => (table === 'space_memberships' ? membershipsQuery : query) }),
}))
vi.mock('../auth/index.js', () => ({ authorizeAndLog: (args: { spaceId: string }) => authorizeMock(args) }))
vi.mock('../auth/helpers.js', () => ({
  checkAuth: (...args: unknown[]) => checkAuthMock(...args),
  checkAuthOrg: vi.fn(),
}))

const { spaceList } = await import('./spaces.js')

beforeEach(() => {
  filters.length = 0
  checkAuthMock.mockClear()
  memberships = []
  authorizeMock.mockReset()
  authorizeMock.mockImplementation(async () => ({ allowed: true }))
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

    await expect(spaceList({})).rejects.toThrow('権限エラー: このAPIキーはどのプロジェクトにも紐づいていません')
  })

  it('組織全体用のキーは今までどおり組織のプロジェクトを全部返す（1件に絞らない）', async () => {
    ctx = { keyId: 'k2', userId: 'u1', orgId: 'org-1', scope: 'org', allowedSpaceIds: null, allowedActions: ['read'] }

    await spaceList({})

    expect(filters).toContainEqual(['eq', 'org_id', 'org-1'])
    expect(filters.some(([, col]) => col === 'id')).toBe(false)
    expect(checkAuthMock).not.toHaveBeenCalled()
  })

  // 個人用の鍵（scope=user）: 選んだプロジェクトのうち、今もメンバーで読み取りが許されるものだけを返す。
  // 役割が後から相手先に変わった・プロジェクトから外れた鍵にも追従する（ほかの道具と同じ権限確認を通す）
  it('個人用の鍵は、権限確認を通ったプロジェクトだけを返す', async () => {
    ctx = { keyId: 'k3', userId: 'u1', orgId: 'org-1', scope: 'user', allowedSpaceIds: ['space-1', 'space-2'], allowedActions: ['read'] }
    memberships = [{ space_id: 'space-1' }, { space_id: 'space-2' }]
    authorizeMock.mockImplementation(async ({ spaceId }) => ({ allowed: spaceId === 'space-1' }))

    await spaceList({})

    expect(authorizeMock).toHaveBeenCalledTimes(2)
    expect(filters).toContainEqual(['in', 'id', ['space-1']])
  })

  it('個人用の鍵は組織をまたげるので、鍵の組織では絞らない', async () => {
    ctx = { keyId: 'k3', userId: 'u1', orgId: 'org-1', scope: 'user', allowedSpaceIds: ['space-1'], allowedActions: ['read'] }
    memberships = [{ space_id: 'space-1' }]

    await spaceList({})

    expect(filters.some(([, col]) => col === 'org_id')).toBe(false)
  })

  it('選んだプロジェクトでも、今メンバーでなければ確認にも回さない', async () => {
    ctx = { keyId: 'k3', userId: 'u1', orgId: 'org-1', scope: 'user', allowedSpaceIds: ['space-1', 'space-9'], allowedActions: ['read'] }
    memberships = [{ space_id: 'space-1' }]

    await spaceList({})

    expect(authorizeMock).toHaveBeenCalledTimes(1)
    expect(filters).toContainEqual(['in', 'id', ['space-1']])
  })

  it('個人用の鍵で読めるプロジェクトが1つも無ければ空を返す', async () => {
    ctx = { keyId: 'k3', userId: 'u1', orgId: 'org-1', scope: 'user', allowedSpaceIds: ['space-1'], allowedActions: ['read'] }
    memberships = [{ space_id: 'space-1' }]
    authorizeMock.mockImplementation(async () => ({ allowed: false }))

    const result = await spaceList({})

    expect(result).toEqual([])
  })

  it('個人用の鍵に持ち主が無ければ断る', async () => {
    ctx = { keyId: 'k3', userId: null, orgId: 'org-1', scope: 'user', allowedSpaceIds: ['space-1'], allowedActions: ['read'] }

    await expect(spaceList({})).rejects.toThrow('権限エラー: このAPIキーに持ち主が設定されていません')
  })

  it('想定外のscope値（DB側の破損等）はツール名と現在のscopeを含む日本語で断る', async () => {
    ctx = { keyId: 'k4', userId: 'u1', orgId: 'org-1', scope: 'unexpected' as Ctx['scope'], allowedSpaceIds: null, allowedActions: ['read'] }

    await expect(spaceList({})).rejects.toThrow(
      '権限エラー: ツール「space_list」は scope=org または scope=user のAPIキーが必要です（現在のscope: unexpected）',
    )
  })

  it('鍵に許可されていない操作は操作名を含む日本語で断る（組織全体用の鍵）', async () => {
    ctx = { keyId: 'k2', userId: 'u1', orgId: 'org-1', scope: 'org', allowedSpaceIds: null, allowedActions: [] }

    await expect(spaceList({})).rejects.toThrow('権限エラー: このAPIキーでは操作「read」を実行できません')
  })
})
