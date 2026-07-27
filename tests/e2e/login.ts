import type { Page } from '@playwright/test'

/**
 * ログインフォームの入力〜送信を、hydration 待ちつきで行う共通処理。
 *
 * **実際に踏んだ不具合**: `domcontentloaded` 直後に `fill()` すると、その後の hydration で
 * React が入力欄を制御下に置いた際に値が消える。値が空のまま送信ボタンを押すことになり、
 * 必須項目の検証で **送信自体が起きない**（認証リクエストが1本も飛ばない）。
 * 画面にはエラーも出ないので、`waitForURL` が30秒待って落ちるだけの無言の失敗になる。
 * 「パスワードが違う」「回数制限」と誤診しやすい。
 *
 * 対策は2段構え:
 *  1. `networkidle` まで待ってから入力する（hydration の完了をおおむね待てる）
 *  2. 入力後に値が残っているか検証し、消えていれば入れ直す（1のあとに hydration が
 *     走った場合の保険）
 */
export async function fillLoginAndSubmit(
  page: Page,
  baseUrl: string,
  email: string,
  password: string,
): Promise<void> {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' })

  const emailInput = page.locator('input[type="email"]')
  const passwordInput = page.locator('input[type="password"]')
  await emailInput.waitFor({ state: 'visible' })

  // hydration で値が消されたら入れ直す。3回試して駄目なら諦めて送信し、
  // 呼び出し側の waitForURL に失敗を委ねる（原因が分かるログを残す）。
  for (let attempt = 0; attempt < 3; attempt++) {
    await emailInput.fill(email)
    await passwordInput.fill(password)
    await page.waitForTimeout(300)
    const kept =
      (await emailInput.inputValue()) === email && (await passwordInput.inputValue()) === password
    if (kept) break
    if (attempt === 2) {
      console.warn('[e2e] ログイン欄の値が hydration で消え続けています（3回試行）')
    }
  }

  await page.getByRole('button', { name: 'ログイン', exact: true }).click()
}
