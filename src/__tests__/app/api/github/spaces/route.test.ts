import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * /api/github/spaces (GET) — ユーザーのセッションで読む。
 * PR-B: select('*') を使わず、埋め込み(github_repositories)も含めて必要な列だけを
 * 名指しする形になっていることを確認する（access_token 等の非公開列を含めない）。
 */

const SPACE_ID = 'b1f9a1c0-1111-4444-8888-000000000001'
const USER_ID = '526fb8e1-0b6a-4ffd-86a3-b3e59db3476a'

let selectArg = ''
let linkedReposResult: { data: unknown; error: unknown } = { data: [], error: null }

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
                  single: vi.fn(() => Promise.resolve({ data: { role: 'admin' } })),
                })),
              })),
            })),
          }
        }
        if (table === 'space_github_repos') {
          return {
            select: vi.fn((cols: string) => {
              selectArg = cols
              return {
                eq: vi.fn(() => Promise.resolve(linkedReposResult)),
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
  return route.GET
}

function req(query: string) {
  return new NextRequest(`http://localhost:4000/api/github/spaces${query}`)
}

beforeEach(() => {
  selectArg = ''
  linkedReposResult = { data: [], error: null }
})

describe('GET /api/github/spaces', () => {
  it('select(*) を使わず、埋め込みにも access_token 等を含まない列だけを select する', async () => {
    const GET = await loadRoute()
    const res = await GET(req(`?spaceId=${SPACE_ID}`))

    expect(res.status).toBe(200)
    expect(selectArg).not.toMatch(/(^|[(,\s])\*/)
    expect(selectArg).not.toMatch(/access_token|token_expires_at/)
  })
})
