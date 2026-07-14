import type { MetadataRoute } from 'next'
import { listPublishedPosts } from '@/lib/blog/posts'

// 公開記事をDBから引くため静的化しない（ビルド時に固定されると新記事が載らない）
export const dynamic = 'force-dynamic'

const SITE = 'https://agentpm.app'

// 公開マーケティング・法務ページ（proxy.ts の publicPaths と対応）
const STATIC_PATHS = [
  '',
  '/pricing',
  '/features',
  '/compare',
  '/use-cases',
  '/contact',
  '/privacy',
  '/terms',
  '/tokushoho',
  '/blog',
]

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticEntries: MetadataRoute.Sitemap = STATIC_PATHS.map((path) => ({
    url: `${SITE}${path}`,
    changeFrequency: 'weekly',
    priority: path === '' ? 1 : 0.7,
  }))

  let postEntries: MetadataRoute.Sitemap = []
  try {
    const posts = await listPublishedPosts()
    postEntries = posts.map((p) => ({
      url: `${SITE}/blog/${p.slug}`,
      lastModified: p.published_at ? new Date(p.published_at) : undefined,
      changeFrequency: 'monthly',
      priority: 0.6,
    }))
  } catch {
    // DB 未接続でも静的サイトマップは返す
  }

  return [...staticEntries, ...postEntries]
}
