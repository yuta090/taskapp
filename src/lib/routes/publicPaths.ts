// 認証不要の公開パス（ホワイトリスト）と、そのマッチ判定。
//
// proxy.ts（認証門番）と、ダークテーマの適用可否判定の両方がここを参照する
// （単一ソース化）。片方だけ書き換えて設定がドリフトするのを防ぐ。
// ⚠ このリストを変えると「未ログインで開けるページ」が変わる。増減は慎重に。

// NOTE: /api は静的ファイルスキップで除外済みのためここに不要
export const publicPaths = [
  '/',
  '/login',
  '/signup',
  '/reset',
  '/invite',
  '/auth/callback',
  '/docs',
  '/admin/login',
  '/contact',
  '/pricing',
  '/privacy',
  '/terms',
  // 特商法表示は購入前の誰もが閲覧できる必要がある（法令要件）
  '/tokushoho',
  '/company',
  // マーケティングページ: ヘッダー・フッターから導線があるため未認証で開けないと集客が成立しない
  '/features',
  '/compare',
  '/use-cases',
  // ヘルプ: 顧客・クライアント（アカウントを持たない相手を含む）が参照する
  '/help',
  // 学びのメディア「TASK6」: SEO記事。未ログインの検索流入が読む
  // （旧 /blog は next.config の redirects で /task6 へ 301 済み。proxy には来ない）
  '/task6',
  // タスク滞留診断: 未ログインのリード獲得ツール(multica-prj/shindan-appから移植)
  '/shindan',
  '/portal/email-action',
] as const

// 静的LP: /lp1, /lp2, ... （public/lp<N>/index.html へ rewrite）。番号付きのみ公開
export const STATIC_LP_PATTERN = /^\/lp\d+(\/|$)/

/** セグメント境界を考慮したパスマッチ（/privacy が /privacy-policy にマッチしない） */
export function isPublicPathMatch(pathname: string): boolean {
  if (STATIC_LP_PATTERN.test(pathname)) return true
  return publicPaths.some(path => {
    if (path === '/') return pathname === '/'
    return pathname === path || pathname.startsWith(path + '/')
  })
}
