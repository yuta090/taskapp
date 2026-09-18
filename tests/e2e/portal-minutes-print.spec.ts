import { test, expect } from './fixtures'
import { fillLoginAndSubmit } from './login'

// 相手先ポータルの議事録「PDFで保存」。押すとブラウザの印刷が開くだけで、何が紙に載るかは
// globals.css の @media print が決めている。印刷のときだけ効く指定なので jsdom では測れない。
// ここは実ブラウザで印刷の見え方に切り替えて、次の2つを固定する。
//   1. 会議名と議事録の本文は紙に出る
//   2. 左メニュー・「議事録詳細」の帯・閉じる／PDFのボタンは紙に出ない
// 相手先のアカウントで入る（社内の storageState は使わない。portal-smoke.spec.ts と同じ流儀）。

test.use({ storageState: { cookies: [], origins: [] } })

const CLIENT_EMAIL = process.env.E2E_CLIENT_EMAIL || 'client1@client.com'
const CLIENT_PASSWORD = process.env.E2E_CLIENT_PASSWORD || 'client1234'

test.describe('相手先ポータルの議事録を PDF で保存', () => {
  test('会議名と本文だけが紙に載り、画面の枠は載らない', async ({ page }) => {
    // hydration 前に入力すると値が消え、送信自体が起きない（tests/e2e/login.ts 参照）
    await fillLoginAndSubmit(page, '', CLIENT_EMAIL, CLIENT_PASSWORD)
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 })

    await page.goto('/portal/meetings')
    await expect(page.getByRole('heading', { name: '議事録', exact: true })).toBeVisible({ timeout: 20000 })

    // 一覧の先頭の会議を開く（議事録の無い会議には PDF のボタンが出ないので、出たものを使う）
    const cards = page.locator('#main-content button')
    await expect(cards.first()).toBeVisible({ timeout: 20000 })
    await cards.first().click()

    const printButton = page.getByTestId('portal-minutes-print-pdf')
    await expect(printButton).toBeVisible({ timeout: 20000 })

    const printRoot = page.locator('[data-print-root]')
    await expect(printRoot).toBeVisible()
    const bodyText = (await printRoot.innerText()).trim()
    expect(bodyText.length).toBeGreaterThan(0)

    await page.emulateMedia({ media: 'print' })

    // 1. 議事録の中身は残る
    await expect(printRoot).toBeVisible()
    expect((await printRoot.innerText()).trim().length).toBeGreaterThan(0)

    // 2. 押すためのものは消える
    await expect(printButton).toBeHidden()
    await expect(page.getByText('議事録詳細')).toBeHidden()

    // 枠の中だけスクロールする作りなので、高さの縛りが外れていないと1画面分で切れる
    const limits = await printRoot.evaluate((el) => {
      const style = getComputedStyle(el)
      return { overflow: style.overflow, maxHeight: style.maxHeight, position: style.position }
    })
    expect(limits).toEqual({ overflow: 'visible', maxHeight: 'none', position: 'static' })

    await page.emulateMedia({ media: null })
  })
})
