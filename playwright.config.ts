import { defineConfig, devices } from '@playwright/test'
import os from 'os'
import path from 'path'
import dotenv from 'dotenv'

/**
 * `.env.local` を読み込む。
 *
 * **実際に踏んだ落とし穴**: 以前はここで env を読んでいなかったため、E2E_PASSWORD 等を
 * コマンドラインで手渡す必要があった。渡し忘れるとテスト側の弱い既定値
 * （client1234 等）が使われ、「メールアドレスまたはパスワードが正しくありません」で
 * 落ちる。原因が資格情報の渡し忘れだと分かりにくく、実際に誤診した。
 * ローカルで `npm run test:e2e` と打つだけで通る状態にしておく。
 */
dotenv.config({ path: path.join(__dirname, '.env.local'), quiet: true })

const STORAGE_STATE = path.join(__dirname, 'tests/e2e/.auth/state.json')

/**
 * 対象URL。既定はローカル開発サーバー。`BASE_URL` を渡すと本番/プレビューへ向けられる
 *   BASE_URL=https://agentpm.app npx playwright test
 *
 * ⚠ 以前は `use.baseURL` がローカル決め打ちで、`BASE_URL` は global-setup（ログイン）だけが
 *   見ていた。そのためリモート指定してもログインだけ本番・テスト本体はlocalhostという
 *   ちぐはぐな状態になり、本番向け実行が事実上できなかった。両者を同じ値に揃える。
 */
const BASE_URL = process.env.BASE_URL || 'http://localhost:4000'

/** ローカル以外を対象にするときは dev サーバーを起動しない（起動しても使われず待ち時間になるだけ）。 */
const IS_LOCAL = BASE_URL.includes('localhost') || BASE_URL.includes('127.0.0.1')

/**
 * ローカル実行の成果物（スクショ・トレース・HTMLレポート）は OS の一時フォルダに出す。
 * この Mac の exFAT ボリュームでは macOS が `._*` を作るため、Playwright が前回の
 * `test-results/` を消せず `ENOTEMPTY` で起動前に落ちる（2026-09-12 に実際に踏んだ）。
 */
const LOCAL_ARTIFACTS = path.join(os.tmpdir(), 'taskapp-e2e')

export default defineConfig({
  testDir: './tests/e2e',
  /**
   * macOS が exFAT ボリューム上に作る `._*`（リソースフォーク）を拾わせない。
   * 拾うと中身がバイナリなので「構文エラー」でスイート全体が起動せず、
   * しかもエラー本文が文字化けして原因が分からない。
   */
  testIgnore: ['**/._*'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: IS_LOCAL ? [['html', { outputFolder: path.join(LOCAL_ARTIFACTS, 'report') }]] : 'html',
  outputDir: IS_LOCAL ? path.join(LOCAL_ARTIFACTS, 'results') : 'test-results',
  // ローカルはページや API の初回表示が本番より遅いので、待ち時間をローカルだけ延ばす
  // （本番・release プレビュー向けは Playwright の既定のまま）
  timeout: IS_LOCAL ? 120_000 : 30_000,
  expect: { timeout: IS_LOCAL ? 30_000 : 5_000 },
  globalSetup: require.resolve('./tests/e2e/global-setup'),
  use: {
    baseURL: BASE_URL,
    storageState: STORAGE_STATE,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // リモート対象時は webServer を立てない（undefined を渡すと Playwright は起動をスキップする）
  // ローカルは本番ビルド（webpack）を立てる。dev サーバーはこの Mac で受信トレイ・マイタスクなど
  // 一部ページの初回コンパイルが止まり、E2E が遷移待ちで落ちるため（2026-09-12 に実測）。
  // ビルドに約3分かかるので、すでに起動しているサーバーがあればそれを使う。
  webServer: IS_LOCAL
    ? {
        command: 'npm run build:local && npm run start:local',
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 600_000,
      }
    : undefined,
})
