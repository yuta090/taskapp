import { test, expect } from './fixtures'

// 目次ブロック（`doc-toc`）は、押したときのスクロールと文字の大きさが実ブラウザでしか
// 測れない。jsdom では `scrollIntoView` も `getComputedStyle` の font-size も当てにならず、
// #980 で入れてから一度も画面で確かめていなかった。ここで次の4つを固定する。
//   1. 「/」の一覧に「目次」が出て、押すと目次ブロックが入る
//   2. 目次の項目数が、そのページの見出しの数と合う
//   3. 項目を押すと、その見出しが画面に入る
//   4. 見出しを足すと、目次もその場で増える（開き直さなくてよい）
//
// 後片付けは Ctrl+Z で戻す。デモ空間のページを共有しているので、入れたものを残さない。

const SPACE_URL = '/00000000-0000-0000-0000-000000000001/project/00000000-0000-0000-0000-000000000010'

/** 「/」の一覧から項目を選ぶ。開くまで待たないと入力が捨てられる */
async function pickFromSlashMenu(page: import('@playwright/test').Page, label: string) {
  await page.keyboard.type('/')
  const menu = page.locator('.bn-suggestion-menu')
  await expect(menu).toBeVisible({ timeout: 10000 })
  await page.keyboard.type(label)
  const item = menu.getByText(label, { exact: true }).first()
  await expect(item).toBeVisible({ timeout: 10000 })
  await item.click()
}

test.describe('Wiki の目次ブロック', () => {
  test('「/」から入れられて、見出しを拾い、押すとその見出しへ飛ぶ', async ({ page }) => {
    await page.goto(`${SPACE_URL}/wiki`)

    // 一覧の先頭のページを開く（ページの id は組織ごとに違うので固定しない）
    const firstRow = page.locator('[data-testid^="wiki-page-row-"]').first()
    await expect(firstRow).toBeVisible({ timeout: 20000 })
    await firstRow.click()

    const editor = page.locator('.bn-editor')
    await expect(editor).toBeVisible({ timeout: 20000 })

    // このページの見出しの数。目次が拾うのと同じ範囲で数える
    const headingCount = await editor.locator('h1, h2, h3').count()
    expect(headingCount, '見出しの無いページでは目次を確かめられない').toBeGreaterThan(1)

    // 本文の末尾に空の段落を作ってから「/」を打つ。既存の行の途中で打つと本文が壊れる
    await editor.click()
    await page.keyboard.press('ControlOrMeta+End')
    await page.keyboard.press('Enter')

    await pickFromSlashMenu(page, '目次')

    // 1・2. 目次が入り、見出しの数と項目の数が合う
    const toc = page.getByTestId('doc-toc')
    await expect(toc).toBeVisible({ timeout: 10000 })
    await expect(toc).toContainText('目次')
    const items = page.getByTestId('doc-toc-item')
    await expect(items).toHaveCount(headingCount)

    // 文字は本文より小さい（text-xs）。「フォントサイズを下げたい」が出発点の要件
    const tocFont = await items.first().evaluate(el => parseFloat(getComputedStyle(el).fontSize))
    const bodyFont = await editor.locator('p').first()
      .evaluate(el => parseFloat(getComputedStyle(el).fontSize))
    expect(tocFont).toBeLessThan(bodyFont)

    // 3. 最後の項目を押すと、その見出しが画面に入る
    const lastItem = items.last()
    const lastText = (await lastItem.innerText()).trim()
    await lastItem.click()
    const target = editor.getByRole('heading', { name: lastText, exact: true }).first()
    await expect(target).toBeInViewport({ timeout: 10000 })

    // 4. 見出しを足すと、目次もその場で増える
    await editor.click()
    await page.keyboard.press('ControlOrMeta+End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('## 目次の自動更新の確認')
    await expect(items).toHaveCount(headingCount + 1, { timeout: 10000 })

    // 後片付け。入れたものを全部戻して、目次が消えるところまで見る
    for (let i = 0; i < 40 && (await toc.count()) > 0; i++) {
      await page.keyboard.press('ControlOrMeta+z')
    }
    await expect(toc).toHaveCount(0, { timeout: 10000 })
  })
})
