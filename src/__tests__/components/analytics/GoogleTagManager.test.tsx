import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

/**
 * GTM の埋め込みコンポーネント。SSR で出る HTML を直接検証する
 * （<noscript> の中身はクライアント描画では見えないため）。
 */
describe('components/analytics/GoogleTagManager', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('有効時: <head> 用は inline <script>、<body> 用は <noscript><iframe>', async () => {
    vi.doMock('@/lib/analytics/gtm', async (importOriginal) => {
      const mod = await importOriginal<typeof import('@/lib/analytics/gtm')>()
      return { ...mod, isGtmEnabled: () => true }
    })
    const { GtmHeadScript, GtmNoScript } = await import('@/components/analytics/GoogleTagManager')

    const head = renderToStaticMarkup(<GtmHeadScript />)
    expect(head).toMatch(/^<script>/)
    expect(head).toContain('GTM-WBJ6P3GJ')
    expect(head).toContain('googletagmanager.com/gtm.js')

    const body = renderToStaticMarkup(<GtmNoScript />)
    expect(body).toMatch(/^<noscript><iframe /)
    expect(body).toContain('src="https://www.googletagmanager.com/ns.html?id=GTM-WBJ6P3GJ"')
    expect(body).toContain('height="0"')
    expect(body).toContain('width="0"')
    expect(body).toContain('display:none')
    expect(body).toContain('visibility:hidden')
  })

  it('無効時（開発・テスト）: 何も出さない', async () => {
    vi.doMock('@/lib/analytics/gtm', async (importOriginal) => {
      const mod = await importOriginal<typeof import('@/lib/analytics/gtm')>()
      return { ...mod, isGtmEnabled: () => false }
    })
    const { GtmHeadScript, GtmNoScript } = await import('@/components/analytics/GoogleTagManager')
    expect(renderToStaticMarkup(<GtmHeadScript />)).toBe('')
    expect(renderToStaticMarkup(<GtmNoScript />)).toBe('')
  })
})
