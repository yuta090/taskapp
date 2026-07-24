import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { proxy } from '../../proxy'
import nextConfig from '../../../next.config'
import sitemap from '../../app/sitemap'

/**
 * 学びのメディア「TASK6」への引っ越し(/blog → /task6)の回帰テスト。
 *
 * - 公開URLは /task6 配下(未ログインの検索流入が読めること)
 * - 旧 /blog は 301 で /task6 へ転送(公開済みURLと外部リンクを死なせない)
 * - 看板ドメイン task6.jp は本体 agentpm.app/task6 へ 301(SEO評価を一箇所に集約)
 * - sitemap は /task6 配下のURLだけを載せる(/blog を載せると転送先と重複扱いになる)
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
    from: () => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn(() => Promise.resolve({ data: null })),
      maybeSingle: vi.fn(() => Promise.resolve({ data: null })),
    }),
  }),
}))

vi.mock('@/lib/blog/posts', () => ({
  listPublishedPosts: vi.fn(() =>
    Promise.resolve([
      {
        slug: 'hello-task6',
        title: 't',
        description: null,
        published_at: '2026-07-24T00:00:00Z',
        cover_image_url: null,
        tags: [],
      },
    ])
  ),
}))

function makeRequest(path: string): NextRequest {
  return new NextRequest(`http://localhost:4000${path}`)
}

describe('/task6 は未ログインで読める公開パス', () => {
  it.each(['/task6', '/task6/some-post'])('%s がログインへ飛ばされない', async (path) => {
    const response = await proxy(makeRequest(path))
    const location = response.headers.get('location')
    expect(location ?? '').not.toContain('/login')
  })
})

describe('next.config の転送設定', () => {
  it('/blog と /blog/:slug が /task6 へ permanent 転送される', async () => {
    const redirects = await nextConfig.redirects!()
    const sources = redirects.map((r) => `${r.source} -> ${r.destination}`)
    expect(sources).toContain('/blog -> /task6')
    expect(sources).toContain('/blog/:slug -> /task6/:slug')
    for (const r of redirects.filter((r) => r.source.startsWith('/blog'))) {
      expect(r.permanent).toBe(true)
    }
  })

  it('task6.jp ホストへのアクセスは agentpm.app/task6 へ転送される', async () => {
    const redirects = await nextConfig.redirects!()
    const hostRules = redirects.filter((r) =>
      (r.has ?? []).some((h) => h.type === 'host' && String(h.value).includes('task6.jp'))
    )
    expect(hostRules.length).toBeGreaterThan(0)
    for (const rule of hostRules) {
      expect(rule.destination).toContain('https://agentpm.app/task6')
      expect(rule.permanent).toBe(true)
    }
  })
})

describe('sitemap は /task6 配下を載せる', () => {
  it('/task6 と記事URLが載り、/blog は載らない', async () => {
    const entries = await sitemap()
    const urls = entries.map((e) => e.url)
    expect(urls).toContain('https://agentpm.app/task6')
    expect(urls).toContain('https://agentpm.app/task6/hello-task6')
    expect(urls.some((u) => u.includes('/blog'))).toBe(false)
  })
})
