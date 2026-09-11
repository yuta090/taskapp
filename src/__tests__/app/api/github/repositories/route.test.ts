import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * /api/github/repositories — ユーザーのセッションで読む GET。
 * PR-B: select('*') を使わず、必要な列だけを名指しする形になっていることを確認する
 * （access_token 等の非公開列を含めないこと・migration適用の前後どちらでも動くこと）。
 *
 * リポジトリ一覧・リポジトリ名は GitHub を接続した本人だけに見せる。組織の他のメンバーには
 * 空一覧(200)ではなく 403 を返す（github_installations をログイン中の本人のセッションで
 * 読み、行が無ければ本人ではないと判定する）。
 */

const ORG_ID = '322a219f-1a73-4935-b061-08b8a5e97334'
const USER_ID = '526fb8e1-0b6a-4ffd-86a3-b3e59db3476a'

let selectArg = ''
let repositoriesResult: { data: unknown; error: unknown } = { data: [], error: null }
let installationResult: { data: { id: string } | null; error: unknown } = {
  data: { id: 'installation-1' },
  error: null,
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: vi.fn(() => Promise.resolve({ data: { user: { id: USER_ID } } })) },
      from: vi.fn((table: string) => {
        if (table === 'org_memberships') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn(() => Promise.resolve({ data: { role: 'admin' } })),
                })),
              })),
            })),
          }
        }
        if (table === 'github_installations') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(() => Promise.resolve(installationResult)),
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
                  order: vi.fn(() => Promise.resolve(repositoriesResult)),
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
  const route = await import('@/app/api/github/repositories/route')
  return route.GET
}

function req(query: string) {
  return new NextRequest(`http://localhost:4000/api/github/repositories${query}`)
}

beforeEach(() => {
  selectArg = ''
  repositoriesResult = { data: [], error: null }
  installationResult = { data: { id: 'installation-1' }, error: null }
})

describe('GET /api/github/repositories', () => {
  it('select(*) を使わず、access_token 等を含まない列だけを select する', async () => {
    const GET = await loadRoute()
    const res = await GET(req(`?orgId=${ORG_ID}`))

    expect(res.status).toBe(200)
    expect(selectArg).not.toMatch(/(^|[(,\s])\*/)
    expect(selectArg).not.toMatch(/access_token|token_expires_at/)
  })

  it('GitHub を接続した本人は今どおりリポジトリ一覧を取得できる', async () => {
    repositoriesResult = {
      data: [{ id: 'repo-1', full_name: 'yuta090/taskapp' }],
      error: null,
    }

    const GET = await loadRoute()
    const res = await GET(req(`?orgId=${ORG_ID}`))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.repositories).toEqual([{ id: 'repo-1', full_name: 'yuta090/taskapp' }])
  })

  it('GitHub を接続した本人以外は 403 で、リポジトリ一覧を返さない', async () => {
    installationResult = { data: null, error: null }
    repositoriesResult = {
      data: [{ id: 'repo-1', full_name: 'yuta090/taskapp' }],
      error: null,
    }

    const GET = await loadRoute()
    const res = await GET(req(`?orgId=${ORG_ID}`))
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body).toEqual({ error: 'GitHub を接続した人だけが操作できます' })
  })

  it('本人判定の問い合わせがエラーのときは 500 を返し、リポジトリ一覧を返さない', async () => {
    installationResult = { data: null, error: { message: 'db down' } }
    repositoriesResult = {
      data: [{ id: 'repo-1', full_name: 'yuta090/taskapp' }],
      error: null,
    }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const GET = await loadRoute()
    const res = await GET(req(`?orgId=${ORG_ID}`))
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.error).not.toBe('GitHub を接続した人だけが操作できます')
    expect(body.repositories).toBeUndefined()
    expect(consoleError).toHaveBeenCalled()

    consoleError.mockRestore()
  })
})
