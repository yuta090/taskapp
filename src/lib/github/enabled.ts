/**
 * GitHub 連携が使える状態かの判定だけを置く、ブラウザに配っても軽いモジュール。
 *
 * config.ts は OAuth state の署名に node の crypto を使うため、クライアントコンポーネントが
 * config.ts から import すると crypto の polyfill（約100KB gzip）まで一緒に配られてしまう。
 * 画面側はこのファイルから import すること。
 */

/**
 * GitHub App が設定されているかチェック
 * NEXT_PUBLIC_ 環境変数を使用してサーバー/クライアント両方で同じ結果を返す
 * (Hydration エラー防止のため)
 */
export function isGitHubConfigured(): boolean {
  // NEXT_PUBLIC_ はサーバー/クライアント両方でアクセス可能
  return process.env.NEXT_PUBLIC_GITHUB_ENABLED === 'true'
}
