import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import nextConfig from '../../../next.config'

/**
 * GTM が「サイトの全ページ」に入っている・弾かれないことの回帰テスト。
 *
 * - Next.js 側の全ページは root layout 経由（<head> 先頭 + <body> 直後）
 * - 静的LP（public/lp<N>/index.html）は layout を通らないので個別に貼る
 * - CSP（外部スクリプトの許可リスト）に GTM / GA4 の通信先を通す
 */
const ROOT = path.resolve(__dirname, '../../..')

describe('GTM install: root layout', () => {
  const src = readFileSync(path.join(ROOT, 'src/app/layout.tsx'), 'utf8')

  it('<head> の最初の要素が GtmHeadScript', () => {
    expect(src).toMatch(/<head>\s*(\{\/\*[\s\S]*?\*\/\}\s*)?<GtmHeadScript \/>/)
  })

  it('<body> 開始タグの直後が GtmNoScript', () => {
    expect(src).toMatch(/<body[^>]*>\s*(\{\/\*[\s\S]*?\*\/\}\s*)?<GtmNoScript \/>/)
  })
})

describe('GTM install: static LPs (public/lp<N>/index.html)', () => {
  const lpDirs = readdirSync(path.join(ROOT, 'public')).filter((d) => /^lp\d+$/.test(d))

  it('静的LPが存在する', () => {
    expect(lpDirs.length).toBeGreaterThan(0)
  })

  it.each(lpDirs)('%s: <head> 直後に GTM スクリプト、<body> 直後に noscript', (dir) => {
    const html = readFileSync(path.join(ROOT, 'public', dir, 'index.html'), 'utf8')
    expect(html).toMatch(/<head>\s*<!-- Google Tag Manager -->\s*<script>[\s\S]*?GTM-WBJ6P3GJ[\s\S]*?<\/script>\s*<!-- End Google Tag Manager -->/)
    expect(html).toMatch(/<body[^>]*>\s*<!-- Google Tag Manager \(noscript\) -->\s*<noscript><iframe src="https:\/\/www\.googletagmanager\.com\/ns\.html\?id=GTM-WBJ6P3GJ"/)
    // 二重貼りしていない
    expect(html.match(/googletagmanager\.com\/gtm\.js/g)?.length).toBe(1)
    expect(html.match(/ns\.html\?id=GTM-WBJ6P3GJ/g)?.length).toBe(1)
  })
})

describe('GTM install: Content-Security-Policy', () => {
  async function csp(): Promise<Record<string, string>> {
    const headers = await nextConfig.headers!()
    const all = headers.find((h) => h.source === '/(.*)')!
    const value = all.headers.find((h) => h.key === 'Content-Security-Policy')!.value
    return Object.fromEntries(
      value.split(';').map((d) => {
        const [name, ...rest] = d.trim().split(/\s+/)
        return [name, rest.join(' ')]
      }),
    )
  }

  it('script-src: gtm.js の読み込みを許可', async () => {
    const d = await csp()
    expect(d['script-src']).toContain('https://www.googletagmanager.com')
  })

  it('connect-src: GTM と GA4 の計測送信先を許可', async () => {
    const d = await csp()
    expect(d['connect-src']).toContain('https://www.googletagmanager.com')
    expect(d['connect-src']).toContain('https://*.google-analytics.com')
    expect(d['connect-src']).toContain('https://*.analytics.google.com')
  })

  it('connect-src: GA4 が www.google.com/g/collect に送る計測を止めない', async () => {
    // 実画面の確認で https://www.google.com/g/collect?tid=G-... が CSP で毎回止められていた（計測の取りこぼし）
    const d = await csp()
    expect(d['connect-src'].split(' ')).toContain('https://www.google.com')
  })

  it('frame-src: noscript 用 iframe を許可', async () => {
    const d = await csp()
    expect(d['frame-src']).toContain('https://www.googletagmanager.com')
  })

  it('img-src: 計測ピクセル（https:）は既に許可済み', async () => {
    const d = await csp()
    expect(d['img-src']).toContain('https:')
  })
})
