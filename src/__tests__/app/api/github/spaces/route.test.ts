import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * /api/github/spaces
 * - GET: ユーザーのセッションで読む。PR-B: select('*') を使わず、埋め込み(github_repositories)
 *   も含めて必要な列だけを名指しする形になっていることを確認する（access_token 等の非公開列を
 *   含めない）。
 * - POST / DELETE: リポジトリの追加・解除は GitHub を接続した本人だけができる
 *   （github_installations をログイン中の本人のセッションで読み、行が無ければ本人ではないと
 *   判定して 403 を返す。何も書き込まない）。1つの組織に複数の接続がありうるため、
 *   `.maybeSingle()`（複数行だとエラーになる）ではなく `.limit(1)` ＋行数で見る。
 * - 本人判定の問い合わせ自体が失敗したときは、403（本人ではない）と区別して 500 を返す。
 */

const SPACE_ID = 'b1f9a1c0-1111-4444-8888-000000000001'
const USER_ID = '526fb8e1-0b6a-4ffd-86a3-b3e59db3476a'
const ORG_ID = '322a219f-1a73-4935-b061-08b8a5e97334'
const REPO_ID = 'c2f9a1c0-2222-5555-9999-000000000002'
const LINK_ID = 'd3f9a1c0-3333-6666-aaaa-000000000003'

let selectArg = ''
let linkedReposResult: { data: unknown; error: unknown } = { data: [], error: null }
let membershipResult: { data: { role: string } | null } = { data: { role: 'admin' } }
let installationResult: { data: Array<{ id: string }> | null; error: unknown } = {
  data: [{ id: 'installation-1' }],
  error: null,
}
let installationEqArgs: unknown[] = []
let spaceResult: { data: { org_id: string } | null } = { data: { org_id: ORG_ID } }
let repoOrgResult: { data: { org_id: string } | null } = { data: { org_id: ORG_ID } }
let insertResult: { data: unknown; error: unknown } = {
  data: { id: LINK_ID, sync_prs: true, sync_commits: false, github_repositories: { id: REPO_ID, full_name: 'yuta090/taskapp' } },
  error: null,
}
let linkFetchResult: { data: { space_id: string; org_id: string } | null } = {
  data: { space_id: SPACE_ID, org_id: ORG_ID },
}
// DELETE の実削除: .delete().eq('id', linkId).select('id') が返す行(0件なら「何も消えなかった」)
let deleteResult: { data: Array<{ id: string }> | null; error: unknown } = {
  data: [{ id: LINK_ID }],
  error: null,
}
const insertSpy = vi.fn()
const deleteSpy = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: vi.fn(() => Promise.resolve({ data: { user: { id: USER_ID } } })) },
      from: vi.fn((table: string) => {
        if (table === 'space_memberships') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn(() => Promise.resolve(membershipResult)),
                })),
              })),
            })),
          }
        }
        if (table === 'github_installations') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn((...args: unknown[]) => {
                installationEqArgs = args
                return {
                  limit: vi.fn(() => Promise.resolve(installationResult)),
                }
              }),
            })),
          }
        }
        if (table === 'spaces') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(() => Promise.resolve(spaceResult)),
              })),
            })),
          }
        }
        if (table === 'github_repositories') {
          return {
            select: vi.fn((cols: string) => {
              selectArg = cols
              return {
                eq: vi.fn(() => ({
                  single: vi.fn(() => Promise.resolve(repoOrgResult)),
                  order: vi.fn(() => Promise.resolve(linkedReposResult)),
                })),
              }
            }),
          }
        }
        if (table === 'space_github_repos') {
          return {
            select: vi.fn((cols: string) => {
              selectArg = cols
              // DELETE: リンク行を1件取得（space_id, org_id を指定）
              if (cols.includes('space_id') && cols.includes('org_id')) {
                return {
                  eq: vi.fn(() => ({
                    single: vi.fn(() => Promise.resolve(linkFetchResult)),
                  })),
                }
              }
              // GET: Spaceの連携一覧
              return {
                eq: vi.fn(() => Promise.resolve(linkedReposResult)),
              }
            }),
            insert: vi.fn((row: unknown) => {
              insertSpy(row)
              return {
                select: vi.fn((cols: string) => {
                  selectArg = cols
                  return {
                    single: vi.fn(() => Promise.resolve(insertResult)),
                  }
                }),
              }
            }),
            delete: vi.fn(() => {
              deleteSpy()
              return {
                eq: vi.fn(() => ({
                  select: vi.fn(() => Promise.resolve(deleteResult)),
                })),
              }
            }),
          }
        }
        return {}
      }),
    }),
  ),
}))

async function loadRoute() {
  vi.resetModules()
  const route = await import('@/app/api/github/spaces/route')
  return route
}

function getReq(query: string) {
  return new NextRequest(`http://localhost:4000/api/github/spaces${query}`)
}

function postReq(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:4000/api/github/spaces', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

function deleteReq(query: string) {
  return new NextRequest(`http://localhost:4000/api/github/spaces${query}`, { method: 'DELETE' })
}

beforeEach(() => {
  selectArg = ''
  linkedReposResult = { data: [], error: null }
  membershipResult = { data: { role: 'admin' } }
  installationResult = { data: [{ id: 'installation-1' }], error: null }
  installationEqArgs = []
  spaceResult = { data: { org_id: ORG_ID } }
  repoOrgResult = { data: { org_id: ORG_ID } }
  insertResult = {
    data: { id: LINK_ID, sync_prs: true, sync_commits: false, github_repositories: { id: REPO_ID, full_name: 'yuta090/taskapp' } },
    error: null,
  }
  linkFetchResult = { data: { space_id: SPACE_ID, org_id: ORG_ID } }
  deleteResult = { data: [{ id: LINK_ID }], error: null }
  insertSpy.mockClear()
  deleteSpy.mockClear()
})

describe('GET /api/github/spaces', () => {
  it('select(*) を使わず、埋め込みにも access_token 等を含まない列だけを select する', async () => {
    const { GET } = await loadRoute()
    const res = await GET(getReq(`?spaceId=${SPACE_ID}`))

    expect(res.status).toBe(200)
    expect(selectArg).not.toMatch(/(^|[(,\s])\*/)
    expect(selectArg).not.toMatch(/access_token|token_expires_at/)
  })
})

describe('POST /api/github/spaces', () => {
  it('GitHub を接続した本人は今どおりリポジトリを追加できる', async () => {
    const { POST } = await loadRoute()
    const res = await POST(postReq({ spaceId: SPACE_ID, githubRepoId: REPO_ID }))

    expect(res.status).toBe(200)
    expect(insertSpy).toHaveBeenCalled()
  })

  it('GitHub を接続した本人以外は 403 で、何も書き込まない', async () => {
    installationResult = { data: [], error: null }

    const { POST } = await loadRoute()
    const res = await POST(postReq({ spaceId: SPACE_ID, githubRepoId: REPO_ID }))
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body).toEqual({ error: 'GitHub を接続した人だけが操作できます' })
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it('接続が複数ある組織でも、1件でもあれば本人として追加できる', async () => {
    installationResult = { data: [{ id: 'installation-1' }, { id: 'installation-2' }], error: null }

    const { POST } = await loadRoute()
    const res = await POST(postReq({ spaceId: SPACE_ID, githubRepoId: REPO_ID }))

    expect(res.status).toBe(200)
    expect(insertSpy).toHaveBeenCalled()
  })

  it('本人判定の問い合わせがエラーのときは 500 を返し、何も書き込まない', async () => {
    installationResult = { data: null, error: { message: 'db down' } }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { POST } = await loadRoute()
    const res = await POST(postReq({ spaceId: SPACE_ID, githubRepoId: REPO_ID }))
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.error).not.toBe('GitHub を接続した人だけが操作できます')
    expect(insertSpy).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalled()

    consoleError.mockRestore()
  })
})

describe('DELETE /api/github/spaces', () => {
  it('GitHub を接続した本人は今どおり連携を解除できる', async () => {
    const { DELETE } = await loadRoute()
    const res = await DELETE(deleteReq(`?linkId=${LINK_ID}`))

    expect(res.status).toBe(200)
    expect(deleteSpy).toHaveBeenCalled()
  })

  it('GitHub を接続した本人以外は 403 で、何も削除しない', async () => {
    installationResult = { data: [], error: null }

    const { DELETE } = await loadRoute()
    const res = await DELETE(deleteReq(`?linkId=${LINK_ID}`))
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body).toEqual({ error: 'GitHub を接続した人だけが操作できます' })
    expect(deleteSpy).not.toHaveBeenCalled()
  })

  it('本人判定は link.org_id で行う（space_idではない）', async () => {
    await (await loadRoute()).DELETE(deleteReq(`?linkId=${LINK_ID}`))

    expect(installationEqArgs).toEqual(['org_id', ORG_ID])
  })

  it('本人判定の問い合わせがエラーのときは 500 を返し、何も削除しない', async () => {
    installationResult = { data: null, error: { message: 'db down' } }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { DELETE } = await loadRoute()
    const res = await DELETE(deleteReq(`?linkId=${LINK_ID}`))
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.error).not.toBe('GitHub を接続した人だけが操作できます')
    expect(deleteSpy).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalled()

    consoleError.mockRestore()
  })

  it('削除が0行(RLS等で実際には消えなかった)のときは403で、「解除しました」を返さない', async () => {
    deleteResult = { data: [], error: null }

    const { DELETE } = await loadRoute()
    const res = await DELETE(deleteReq(`?linkId=${LINK_ID}`))
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.success).not.toBe(true)
  })
})
