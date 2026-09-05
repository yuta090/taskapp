import { buildGtmHeadScript, gtmNoScriptSrc, isGtmEnabled } from '@/lib/analytics/gtm'

/**
 * Google タグマネージャー（GTM）の埋め込み。root layout で使う。
 *
 * - <GtmHeadScript />: <head> の先頭に置く inline スクリプト
 * - <GtmNoScript />: <body> 開始タグの直後に置く noscript フォールバック
 *
 * next/script ではなく素の <script> を使う理由: hydration を待たずに描画直後から
 * 計測を始めるため（テーマ初期化スクリプトと同じ方式）。静的LP(public/lp<N>)は
 * この layout を通らないので、同じスニペットを HTML に直接貼っている。
 */
export function GtmHeadScript() {
  if (!isGtmEnabled()) return null
  return <script dangerouslySetInnerHTML={{ __html: buildGtmHeadScript() }} />
}

export function GtmNoScript() {
  if (!isGtmEnabled()) return null
  return (
    <noscript>
      <iframe
        src={gtmNoScriptSrc()}
        height="0"
        width="0"
        style={{ display: 'none', visibility: 'hidden' }}
        title="Google Tag Manager"
      />
    </noscript>
  )
}
