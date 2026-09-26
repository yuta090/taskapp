import { test, expect } from './fixtures'

// 会議中に議事録の中のタスクを開くと、タスク一覧へ画面が移ってしまい議事録に戻るのが
// 面倒だった（ユーザー申告）。議事録は出したまま、右パネルでタスク詳細を開く。
// クリックの横取りはエディタの枠に capture で付けていて jsdom では BlockNote ごとは測れないので、
// 実ブラウザで固定する。
//
// 本文には打たない（本番の議事録を壊さないため）。リンクはエディタの枠の中・編集できる
// 領域の外に差し込む。枠が拾うクリックとしては本文のリンクと同じ扱いになる。

const ORG = '00000000-0000-0000-0000-000000000001'
const SPACE = '00000000-0000-0000-0000-000000000010'
const SPACE_URL = `/${ORG}/project/${SPACE}`

test.describe('議事録の中のタスク・Wiki をその場で開く', () => {
  test('画面を移らずに右パネルでタスクを開き、×で会議詳細に戻る', async ({ page }) => {
    // デモのプロジェクトのタスクを1件選ぶ（id は環境ごとに違うので固定しない）
    await page.goto(`${SPACE_URL}?filter=all`)
    const firstTask = page.locator('.task-row').first()
    await expect(firstTask).toBeVisible({ timeout: 20000 })
    await firstTask.click()
    await expect(page).toHaveURL(/[?&]task=/)
    const taskId = new URL(page.url()).searchParams.get('task')!

    await page.goto(`${SPACE_URL}/meetings`)
    const firstRow = page.locator('[data-testid^="meeting-row-"]').first()
    await expect(firstRow).toBeVisible({ timeout: 20000 })
    await firstRow.click()
    const editor = page.getByTestId('minutes-editor')
    await expect(editor.locator('.bn-editor')).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('meeting-inspector')).toBeVisible()
    const minutesUrl = page.url()

    await editor.evaluate((el, href) => {
      const a = document.createElement('a')
      a.href = href
      a.textContent = 'E2E タスクへのリンク'
      // data-testid にしない（e2eContract は「E2E が指す testid が実装にあるか」を見る。これは差し込む物）
      a.setAttribute('data-e2e', 'task-link')
      el.appendChild(a)
    }, `${SPACE_URL}?task=${taskId}`)

    await page.locator('[data-e2e="task-link"]').click()

    // 画面は議事録のまま、右パネルがタスク詳細に替わる
    await expect(page.getByTestId('task-inspector-close')).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('minutes-document-view')).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`/meetings\\?.*task=${taskId}`))
    expect(page.context().pages()).toHaveLength(1)

    // ×で閉じると会議詳細に戻る
    await page.getByTestId('task-inspector-close').click()
    await expect(page.getByTestId('meeting-inspector')).toBeVisible()
    await expect(page).toHaveURL(minutesUrl)

    // ブラウザの「戻る」でもパネルだけが閉じる
    await page.locator('[data-e2e="task-link"]').click()
    await expect(page.getByTestId('task-inspector-close')).toBeVisible({ timeout: 20000 })
    await page.goBack()
    await expect(page.getByTestId('meeting-inspector')).toBeVisible()
    await expect(page.getByTestId('minutes-document-view')).toBeVisible()
  })

  test('Wiki は議事録の上に重ねて開き、Esc・「戻る」で議事録に戻る', async ({ page }) => {
    // フォルダではない Wiki ページを1件選ぶ
    await page.goto(`${SPACE_URL}/wiki`)
    const wikiRow = page
      .locator('[data-testid^="wiki-page-row-"]')
      .filter({ hasNot: page.getByTestId('wiki-folder-icon') })
      .first()
    await expect(wikiRow).toBeVisible({ timeout: 20000 })
    const pageId = (await wikiRow.getAttribute('data-testid'))!.replace('wiki-page-row-', '')

    await page.goto(`${SPACE_URL}/meetings`)
    const firstRow = page.locator('[data-testid^="meeting-row-"]').first()
    await expect(firstRow).toBeVisible({ timeout: 20000 })
    await firstRow.click()
    const editor = page.getByTestId('minutes-editor')
    await expect(editor.locator('.bn-editor')).toBeVisible({ timeout: 20000 })
    const minutesUrl = page.url()

    await editor.evaluate((el, href) => {
      const a = document.createElement('a')
      a.href = href
      a.textContent = 'E2E Wiki へのリンク'
      a.setAttribute('data-e2e', 'wiki-link')
      el.appendChild(a)
    }, `${SPACE_URL}/wiki?page=${pageId}`)

    await page.locator('[data-e2e="wiki-link"]').click()

    // 議事録の上に重なり、本文が読める。画面は議事録のまま
    const overlay = page.getByTestId('wiki-overlay')
    await expect(overlay).toBeVisible()
    await expect(overlay.locator('.bn-editor')).toBeVisible({ timeout: 20000 })
    await expect(overlay.locator('.bn-editor [contenteditable="true"]')).toHaveCount(0)
    await expect(page).toHaveURL(new RegExp(`/meetings\\?.*wiki=${pageId}`))
    expect(page.context().pages()).toHaveLength(1)

    // Esc で閉じる
    await page.keyboard.press('Escape')
    await expect(overlay).toBeHidden()
    await expect(page).toHaveURL(minutesUrl)
    await expect(page.getByTestId('minutes-document-view')).toBeVisible()

    // ブラウザの「戻る」でも Wiki だけが閉じる
    await page.locator('[data-e2e="wiki-link"]').click()
    await expect(overlay).toBeVisible()
    await page.goBack()
    await expect(overlay).toBeHidden()
    await expect(page.getByTestId('minutes-document-view')).toBeVisible()
  })
})
