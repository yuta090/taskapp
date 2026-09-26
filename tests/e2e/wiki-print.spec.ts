import { test, expect } from './fixtures'

// Wiki ページの「PDFで保存」は、押すとブラウザの印刷が開くだけで、何が紙に載るかは
// globals.css の @media print が決めている。印刷のときだけ効く指定なので jsdom では
// 測れない。ここは実ブラウザで印刷の見え方に切り替えて、次の3つを固定する。
//   1. ページ名と本文は紙に出る
//   2. 左メニュー・右のページ情報・ボタン類は紙に出ない
//   3. 目印の無い画面（タスク一覧）は、刷っても白紙にならない
// 3 は一度踏んだ穴。「かたまりの外を消す」規則の囲いを外すと全画面が白紙になる。

const SPACE_URL = '/00000000-0000-0000-0000-000000000001/project/00000000-0000-0000-0000-000000000010'

test.describe('Wiki を PDF で保存したときに紙へ載る範囲', () => {
  test('ページ名と本文だけが紙に載り、画面の枠は載らない', async ({ page }) => {
    await page.goto(`${SPACE_URL}/wiki`)

    // 一覧の先頭のページを開く（ページの id は組織ごとに違うので固定しない）。
    // フォルダは本文が空のことがある（別の E2E が作って消している途中のものも含む）ので除く。
    // 別の E2E が同時に作っている「E2E〜」のページも、本文を書いている途中なので除く
    // （wiki-heading-link.spec.ts と並んで走ると、書きかけの短いページを刷って落ちた）
    const firstRow = page
      .locator('[data-testid^="wiki-page-row-"]')
      .filter({ hasNot: page.getByTestId('wiki-folder-icon') })
      .filter({ hasNot: page.getByRole('heading', { name: /^E2E/ }) })
      .first()
    await expect(firstRow).toBeVisible({ timeout: 20000 })
    const pageTitle = (await firstRow.innerText()).split('\n')[0].trim()
    await firstRow.click()

    const printRoot = page.locator('[data-print-root]')
    await expect(printRoot).toBeVisible({ timeout: 20000 })
    await expect(page.locator('.bn-editor')).toBeVisible({ timeout: 20000 })

    await page.emulateMedia({ media: 'print' })

    // 1. ページ名と本文は残る
    await expect(printRoot).toBeVisible()
    await expect(page.getByRole('heading', { name: pageTitle })).toBeVisible()
    await expect(page.locator('.bn-editor')).toBeVisible()

    // 2. 画面の枠は消える。ヘッダーのボタン類と、右のページ情報パネル
    await expect(page.getByTestId('wiki-fullscreen-toggle')).toBeHidden()
    await expect(page.getByLabel('一覧へ戻る')).toBeHidden()
    await expect(page.getByTestId('wiki-print-pdf')).toBeHidden()

    // 枠の中だけスクロールする作りなので、高さの縛りを外せていないと1画面分で切れる。
    // かたまりの高さが画面の高さより大きいことで「全文が展開されている」ことを見る
    const printRootHeight = await printRoot.evaluate(el => el.getBoundingClientRect().height)
    const viewportHeight = page.viewportSize()?.height ?? 720
    expect(printRootHeight).toBeGreaterThan(viewportHeight * 0.9)

    await page.emulateMedia({ media: null })
  })

  test('目印の無い画面（タスク一覧）は、刷っても白紙にならない', async ({ page }) => {
    await page.goto(SPACE_URL)
    await expect(page.getByRole('navigation', { name: 'パンくずリスト' })).toBeVisible({ timeout: 20000 })

    await page.emulateMedia({ media: 'print' })

    const visibleTextCount = await page.evaluate(() => {
      let n = 0
      for (const el of document.querySelectorAll('body *')) {
        const style = getComputedStyle(el)
        if (style.display === 'none' || style.visibility === 'hidden') continue
        if (el.children.length === 0 && (el.textContent ?? '').trim()) n++
      }
      return n
    })
    expect(visibleTextCount).toBeGreaterThan(10)

    await page.emulateMedia({ media: null })
  })
})
