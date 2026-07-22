import { test, expect } from './fixtures'

// Regression test for commit f9ab6a0: PortalLeftNav calls
// usePortalVisibilityForPortal (React Query), but src/app/portal and
// src/app/vendor-portal had no QueryClientProvider in their subtree, so every
// page using PortalShell crashed with "No QueryClient set, use
// QueryClientProvider to set one" and rendered the ErrorFallback boundary.
//
// This test logs in as a client demo account (not the internal storageState
// from global-setup) and asserts the portal renders without a page error or
// the error boundary text.
test.use({ storageState: { cookies: [], origins: [] } })

// 資格情報は環境変数で差し替え可能にする（既定はローカルseedの値）。
// リモート(本番/プレビュー)ではデモアカウントのパスワードが強いものに差し替わっており、
// ここを固定値にしているとログインできずタイムアウトする。global-setup と同じ流儀。
const CLIENT_EMAIL = process.env.E2E_CLIENT_EMAIL || 'client1@client.com'
const CLIENT_PASSWORD = process.env.E2E_CLIENT_PASSWORD || 'client1234'

async function loginAsClient(page: import('@playwright/test').Page) {
  await page.goto('/login')
  await page.locator('input[type="email"]').fill(CLIENT_EMAIL)
  await page.locator('input[type="password"]').fill(CLIENT_PASSWORD)
  await page.getByRole('button', { name: 'ログイン', exact: true }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), {
    timeout: 30_000,
  })
}

test.describe('Portal smoke test', () => {
  test('dashboard renders without crashing after login', async ({ page }) => {
    const pageErrors: Error[] = []
    page.on('pageerror', (error) => pageErrors.push(error))

    await loginAsClient(page)
    await expect(page).toHaveURL(/\/portal$/)

    await expect(page.getByRole('heading', { name: 'プロジェクトダッシュボード' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'エラーが発生しました', exact: true })).not.toBeVisible()
    expect(pageErrors).toEqual([])
  })

  test('portal tasks page renders without crashing', async ({ page }) => {
    const pageErrors: Error[] = []
    page.on('pageerror', (error) => pageErrors.push(error))

    await loginAsClient(page)
    await expect(page).toHaveURL(/\/portal$/)

    await page.goto('/portal/tasks')
    await expect(page.getByRole('heading', { name: 'エラーが発生しました', exact: true })).not.toBeVisible()
    expect(pageErrors).toEqual([])
  })
})
