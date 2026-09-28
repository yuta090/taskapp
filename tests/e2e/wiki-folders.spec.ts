import { test, expect } from './fixtures'

// Wiki のフォルダ（PR5）を実ブラウザで一通り触る。jsdom では HTML5 のドラッグ＆ドロップと
// 確認ダイアログの流れを通しで確かめられないので、ここで固定する。
//   1. 「新しいフォルダ」で作ると、フォルダのアイコン付きで一覧に出る
//   2. フォルダを別のフォルダの上へドラッグすると、その中に入る（字下げされる）
//   3. 「…」→「名前を変更」でその場で名前を変えられる
//   4. 「…」→「削除」で確認をはさみ、中身は1つ上の階層へ戻る
// 作ったフォルダは最後に消す（デモ組織のデータを汚さない）。

const SPACE_URL = '/00000000-0000-0000-0000-000000000001/project/00000000-0000-0000-0000-000000000010'

test.describe('Wiki のフォルダ', () => {
  test('作成・ドラッグで移動・名前変更・削除ができる', async ({ page }) => {
    const stamp = Date.now()
    const outer = `E2Eフォルダ外-${stamp}`
    const inner = `E2Eフォルダ内-${stamp}`
    const renamed = `E2Eフォルダ改名-${stamp}`

    await page.goto(`${SPACE_URL}/wiki`)
    await expect(page.locator('[data-testid^="wiki-page-row-"]').first()).toBeVisible({ timeout: 20000 })

    const rowByTitle = (title: string) =>
      page.locator('[data-testid^="wiki-page-row-"]').filter({ has: page.getByRole('heading', { name: title, exact: true }) })

    const createFolder = async (title: string) => {
      await page.getByTestId('wiki-new-folder').click()
      const input = page.getByTestId('wiki-inline-create-row').locator('input')
      await expect(input).toBeVisible()
      await input.fill(title)
      await input.press('Enter')
      await expect(rowByTitle(title)).toBeVisible({ timeout: 15000 })
    }

    // 1. 作成（押すとフォルダ表示に切り替わる）
    await createFolder(outer)
    await createFolder(inner)
    await expect(page.getByTestId('wiki-view-folder')).toHaveAttribute('aria-pressed', 'true')
    await expect(rowByTitle(outer).getByTestId('wiki-folder-icon')).toBeVisible()

    // 2. ドラッグで inner を outer の中へ。字下げ（左の余白）が増えることで中に入ったと見る
    const paddingOf = async (title: string) =>
      rowByTitle(title).evaluate(el => parseFloat(getComputedStyle(el).paddingLeft))
    const before = await paddingOf(inner)
    await rowByTitle(inner).dragTo(rowByTitle(outer))
    await expect.poll(() => paddingOf(inner), { timeout: 15000 }).toBeGreaterThan(before)

    // 3. 名前変更（編集中は見出しが入力欄に置き換わるので、行は id で押さえておく）
    const outerRowId = (await rowByTitle(outer).getAttribute('data-testid'))!
    await rowByTitle(outer).getByRole('button', { name: 'フォルダの操作' }).click()
    await page.getByTestId('wiki-folder-menu').getByRole('button', { name: '名前を変更' }).click()
    const renameInput = page.getByTestId(outerRowId).locator('input')
    await expect(renameInput).toBeVisible()
    await renameInput.fill(renamed)
    await renameInput.press('Enter')
    await expect(rowByTitle(renamed)).toBeVisible({ timeout: 15000 })

    // 4. 削除 → inner は一番上の階層へ戻る
    await rowByTitle(renamed).getByRole('button', { name: 'フォルダの操作' }).click()
    await page.getByTestId('wiki-folder-menu').getByRole('button', { name: '削除' }).click()
    await page.getByRole('button', { name: '削除する' }).click()
    await expect(rowByTitle(renamed)).toHaveCount(0, { timeout: 15000 })
    await expect.poll(() => paddingOf(inner), { timeout: 15000 }).toBe(before)

    // 後片付け: inner も消す
    await rowByTitle(inner).getByRole('button', { name: 'フォルダの操作' }).click()
    await page.getByTestId('wiki-folder-menu').getByRole('button', { name: '削除' }).click()
    await page.getByRole('button', { name: '削除する' }).click()
    await expect(rowByTitle(inner)).toHaveCount(0, { timeout: 15000 })
    // 画面からは楽観更新ですぐ消えるので、削除の通信が終わるまで待ってから閉じる
    // （待たないと通信が途中で切れ、デモ組織にフォルダが残る）
    await page.waitForLoadState('networkidle')
  })
})
