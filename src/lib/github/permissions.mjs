// GitHub App の許可範囲・購読イベントの正本（1か所だけ）。
//
// crypto を含まない純データ。プレーンな ESM (.mjs) にしているのは、
// `scripts/setup-github-app.mjs`（TypeScript を通さない Node CLI）からも
// `src/lib/github/config.ts`（Next にバンドルされる TypeScript）からも、
// 同じ値を読ませるため。どちらか一方だけを直すとテストが落ちる
// （GITHUB_ISSUES_LINK_SPEC.md §7.6・§9 PR0b）。
//
// installation 系イベント（installation / installation_repositories）は
// GitHub App に対して常に届くため、ここには含めない。

/** GitHub App のインストールに求める許可範囲 */
export const GITHUB_APP_PERMISSIONS = {
  pull_requests: 'read',
  issues: 'write',
  metadata: 'read',
}

/** GitHub App が購読する webhook イベント */
export const GITHUB_APP_EVENTS = ['pull_request', 'issues']
