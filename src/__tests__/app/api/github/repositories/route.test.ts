import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * /api/github/repositories — ユーザーのセッションで読む GET。
 * PR-B: select('*') を使わず、必要な列だけを名指しする形になっていることを確認する
 * （access_token 等の非公開列を含めないこと・migration適用の前後どちらでも動くこと）。
 */

const ORG_ID = '322a219f-1a73-4935-b061-08b8a5e97334'
const USER_ID = '526fb8e1-0b6a-4ffd-86a3-b3e59db3476a'

let selectArg = ''
let repositoriesResult: { data: unknown; error: unknown } = { data: [], error: null }

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
})

describe('GET /api/github/repositories', () => {
  it('select(*) を使わず、access_token 等を含まない列だけを select する', async () => {
    const GET = await loadRoute()
    const res = await GET(req(`?orgId=${ORG_ID}`))

    expect(res.status).toBe(200)
    expect(selectArg).not.toMatch(/(^|[(,\s])\*/)
    expect(selectArg).not.toMatch(/access_token|token_expires_at/)
  })
})
