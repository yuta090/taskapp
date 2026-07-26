import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { proxy } from '../../proxy'
import sitemap from '../../app/sitemap'

/**
 * タスク滞留診断(/shindan)の公開設定の回帰テスト。
 * - 未ログインのリード獲得ツールなので、ログインへ飛ばされてはいけない
 * - sitemapに載せて検索エンジンにも見つけてもらう
 */

vi.mock('@/lib/org/resolveActiveOrg', () => ({
  resolveActiveOrg: vi.fn(() => Promise.resolve(null)),
}))

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      getUser: vi.fn(() => Promise.resolve({ data: { user: null } })),
      getSession: vi.fn(() => Promise.resolve({ data: { session: null } })),
    },
  }),
}))

vi.mock('@/lib/blog/posts', () => ({
  listPublishedPosts: vi.fn(() => Promise.resolve([])),
}))

function makeRequest(path: string): NextRequest {
  return new NextRequest(`http://localhost:4000${path}`)
}

describe('/shindan は未ログインで使える公開パス', () => {
  it.each(['/shindan', '/shindan/q'])('%s がログインへ飛ばされない', async (path) => {
    const response = await proxy(makeRequest(path))
    const location = response.headers.get('location')
    expect(location ?? '').not.toContain('/login')
  })
})

describe('sitemap', () => {
  it('/shindan が載っている', async () => {
    const entries = await sitemap()
    const urls = entries.map((e) => e.url)
    expect(urls).toContain('https://agentpm.app/shindan')
  })
})
