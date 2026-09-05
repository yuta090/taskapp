/**
 * Google タグマネージャー（GTM）の埋め込み。
 *
 * - 埋め込み先: root layout（Next.js 側の全ページ）＋ public/lp<N>/index.html（静的LP）
 * - コンテナIDは秘密情報ではない（HTMLに露出する前提のID）ので定数で持つ
 * - 本番ビルド（NODE_ENV=production）だけ有効。ローカル開発やテストの操作を計測に混ぜない
 * - CSP（next.config.ts）で googletagmanager.com / GA4 の通信先を許可している。
 *   GTM 内で GA4 以外のタグ（広告計測など）を足すときは CSP にも通信先を追加すること
 */
export const GTM_CONTAINER_ID = 'GTM-WBJ6P3GJ'

type GtmEnv = { NODE_ENV?: string; NEXT_PUBLIC_GTM_DISABLED?: string }

/** 本番ビルドだけ有効。NEXT_PUBLIC_GTM_DISABLED=1 で緊急停止できる */
export function isGtmEnabled(env: GtmEnv = process.env): boolean {
  if (env.NEXT_PUBLIC_GTM_DISABLED === '1') return false
  return env.NODE_ENV === 'production'
}

/** <head> 先頭の inline <script> 本体（Google 管理画面のスニペットと同一・タグは含まない） */
export function buildGtmHeadScript(id: string = GTM_CONTAINER_ID): string {
  return (
    "(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':" +
    "new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0]," +
    "j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=" +
    "'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);" +
    `})(window,document,'script','dataLayer','${id}');`
  )
}

/** <body> 直後の <noscript><iframe> の src */
export function gtmNoScriptSrc(id: string = GTM_CONTAINER_ID): string {
  return `https://www.googletagmanager.com/ns.html?id=${id}`
}
