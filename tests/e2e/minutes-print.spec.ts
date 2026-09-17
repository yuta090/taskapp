import { test, expect } from './fixtures'

// 議事録の「PDFで保存」は、押すとブラウザの印刷が開くだけで、何が紙に載るかは
// globals.css の @media print が決めている。印刷のときだけ効く指定なので jsdom では
// 測れない。ここは実ブラウザで印刷の見え方に切り替えて、次の2つを固定する。
//   1. 会議名・日時と本文は紙に出る
//   2. 左メニュー・右の会議情報・ボタン類・知らせの帯は紙に出ない
// 「目印の無い画面を刷っても白紙にならない」は Wiki と同じ規則を共有しているので
// wiki-print.spec.ts 側で見る（同じ規則を二重に測らない）。

const SPACE_URL = '/00000000-0000-0000-0000-000000000001/project/00000000-0000-0000-0000-000000000010'

test.describe('議事録を PDF で保存したときに紙へ載る範囲', () => {
  test('会議名と本文だけが紙に載り、画面の枠は載らない', async ({ page }) => {
    await page.goto(`${SPACE_URL}/meetings`)

    // 一覧の先頭の会議を開く（会議の id は組織ごとに違うので固定しない）
    const firstRow = page.locator('[data-testid^="meeting-row-"]').first()
    await expect(firstRow).toBeVisible({ timeout: 20000 })
    await firstRow.click()

    const printRoot = page.locator('[data-print-root]')
    await expect(printRoot).toBeVisible({ timeout: 20000 })
    await expect(page.locator('.bn-editor')).toBeVisible({ timeout: 20000 })
    const meetingTitle = (await page.getByTestId('minutes-document-view').getByRole('heading').first().innerText()).trim()

    await page.emulateMedia({ media: 'print' })

    // 1. 会議名と本文は残る
    await expect(printRoot).toBeVisible()
    await expect(page.getByRole('heading', { name: meetingTitle }).first()).toBeVisible()
    await expect(page.locator('.bn-editor')).toBeVisible()

    // 2. 画面の枠は消える。ヘッダーのボタン類と、右の会議情報パネル
    await expect(page.getByTestId('minutes-fullscreen-toggle')).toBeHidden()
    await expect(page.getByLabel('会議一覧へ戻る')).toBeHidden()
    await expect(page.getByTestId('meeting-print-pdf')).toBeHidden()

    // 本文の下の差し込みツールバー（「会議メモ」など）も紙には出さない
    await expect(page.getByTestId('minutes-insert-meeting-note')).toBeHidden()

    // 議事録は枠の中だけをスクロールする作りなので、高さの縛りを外せていないと長い議事録が
    // 1画面分で切れる。デモの会議は本文の量がまちまちなので、高さそのものではなく
    // 「縛りが外れていること」を見る（外れていれば紙のページ数だけ続く）
    const limits = await page.evaluate(() => {
      const root = document.querySelector('[data-print-root]') as HTMLElement
      const box = document.querySelector('[data-testid="minutes-scroll-box"]') as HTMLElement
      const rootStyle = getComputedStyle(root)
      const boxStyle = getComputedStyle(box)
      return {
        rootOverflow: rootStyle.overflow,
        rootMaxHeight: rootStyle.maxHeight,
        boxOverflow: boxStyle.overflow,
        boxMaxHeight: boxStyle.maxHeight,
      }
    })
    expect(limits).toEqual({
      rootOverflow: 'visible',
      rootMaxHeight: 'none',
      boxOverflow: 'visible',
      boxMaxHeight: 'none',
    })

    await page.emulateMedia({ media: null })
  })
})
