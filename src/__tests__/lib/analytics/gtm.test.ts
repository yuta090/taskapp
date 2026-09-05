import { describe, it, expect } from 'vitest'
import {
  GTM_CONTAINER_ID,
  buildGtmHeadScript,
  gtmNoScriptSrc,
  isGtmEnabled,
} from '@/lib/analytics/gtm'

/**
 * Google タグマネージャー（GTM）の埋め込み本体。
 * - 管理画面で発行されたコンテナIDをそのまま使う
 * - 本番ビルドだけで有効（ローカル開発やテストの操作を計測に混ぜない）
 */
describe('lib/analytics/gtm', () => {
  it('コンテナIDは管理画面で発行されたもの', () => {
    expect(GTM_CONTAINER_ID).toBe('GTM-WBJ6P3GJ')
  })

  it('<head> 用スクリプトは公式スニペットの形（dataLayer 初期化 + gtm.js の非同期読み込み）', () => {
    const s = buildGtmHeadScript()
    expect(s).toContain("'https://www.googletagmanager.com/gtm.js?id='+i+dl")
    expect(s).toContain("'gtm.start'")
    expect(s).toContain("'dataLayer','GTM-WBJ6P3GJ'")
    // <script> タグ自体は含めない（React 側で包む）
    expect(s).not.toMatch(/<\/?script/i)
  })

  it('別IDを渡せば差し替わる', () => {
    expect(buildGtmHeadScript('GTM-XXXX')).toContain("'dataLayer','GTM-XXXX'")
    expect(gtmNoScriptSrc('GTM-XXXX')).toBe('https://www.googletagmanager.com/ns.html?id=GTM-XXXX')
  })

  it('noscript 用 iframe の URL', () => {
    expect(gtmNoScriptSrc()).toBe('https://www.googletagmanager.com/ns.html?id=GTM-WBJ6P3GJ')
  })

  it('本番ビルドだけ有効', () => {
    expect(isGtmEnabled({ NODE_ENV: 'production' })).toBe(true)
    expect(isGtmEnabled({ NODE_ENV: 'development' })).toBe(false)
    expect(isGtmEnabled({ NODE_ENV: 'test' })).toBe(false)
    expect(isGtmEnabled({})).toBe(false)
  })

  it('NEXT_PUBLIC_GTM_DISABLED=1 で本番でも止められる（緊急停止用）', () => {
    expect(isGtmEnabled({ NODE_ENV: 'production', NEXT_PUBLIC_GTM_DISABLED: '1' })).toBe(false)
  })
})
