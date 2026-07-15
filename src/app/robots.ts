import type { MetadataRoute } from 'next'

const SITE = 'https://agentpm.app'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // アプリ内部・管理・APIはクロールさせない
      disallow: ['/admin', '/api', '/portal', '/inbox', '/settings'],
    },
    sitemap: `${SITE}/sitemap.xml`,
  }
}
