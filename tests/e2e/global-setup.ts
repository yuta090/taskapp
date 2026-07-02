import { chromium, type FullConfig } from '@playwright/test'
import fs from 'fs'
import path from 'path'

const BASE_URL = process.env.BASE_URL || 'http://localhost:4000'
const STORAGE_STATE = path.join(__dirname, '.auth/state.json')

// Demo credentials come from the login screen's built-in demo accounts.
// Do not log these values.
const DEMO_EMAIL = process.env.E2E_EMAIL || 'demo@example.com'
const DEMO_PASSWORD = process.env.E2E_PASSWORD || 'demo1234'

export default async function globalSetup(_config: FullConfig) {
  fs.mkdirSync(path.dirname(STORAGE_STATE), { recursive: true })

  const browser = await chromium.launch()
  const context = await browser.newContext()
  const page = await context.newPage()

  try {
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' })

    await page.locator('input[type="email"]').fill(DEMO_EMAIL)
    await page.locator('input[type="password"]').fill(DEMO_PASSWORD)
    await page.getByRole('button', { name: 'ログイン', exact: true }).click()

    // Wait until the client-side redirect moves us away from /login.
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), {
      timeout: 30_000,
    })

    // Ensure the Supabase session cookie is present before saving state.
    await page.waitForFunction(
      () => document.cookie.includes('sb-') || document.cookie.length > 0,
      { timeout: 10_000 }
    ).catch(() => { /* cookie check is best-effort */ })

    // Suppress the first-run internal onboarding walkthrough so it does not
    // overlay pages during tests. This flag is client-side localStorage only
    // (no DB write); it puts the app in a normal "returning user" state.
    await page.evaluate(() => {
      try {
        localStorage.setItem('taskapp_internal_onboarded', 'true')
      } catch {
        /* localStorage unavailable */
      }
    })

    await context.storageState({ path: STORAGE_STATE })
  } finally {
    await browser.close()
  }
}
