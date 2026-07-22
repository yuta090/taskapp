import { defineConfig, devices } from '@playwright/test'
import path from 'path'

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

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
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
  webServer: IS_LOCAL
    ? {
        command: 'npm run dev',
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      }
    : undefined,
})
