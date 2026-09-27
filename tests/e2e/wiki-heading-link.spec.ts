import { test, expect } from './fixtures'

// 見出しへのリンク（Wiki）。jsdom では配置もスクロールも計算されないので、実ブラウザで固定する。
//   1. `?page=<id>#<見出しのアンカー>` で開くと、その見出しが画面の中に入る
//   2. 見出しにマウスを乗せると「見出しへのリンクをコピー」が出て、押すと URL がコピーされる
// 作ったページは最後に消す（デモ組織のデータを汚さない）。

const SPACE_URL = '/00000000-0000-0000-0000-000000000001/project/00000000-0000-0000-0000-000000000010'

/** 見出しより前に置く段落の数。見出しが最初の画面の外に出るだけの長さにする */
const FILLER_LINES = 40

test.describe('Wiki の見出しへのリンク', () => {
  test('# 付きの URL で見出しまで動き、見出しのリンクをコピーできる', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    const title = `E2E見出しリンク-${Date.now()}`
    const target = '2. 振り分けの結果'
    const anchor = '2-振り分けの結果'

    // ページを作る
    await page.goto(`${SPACE_URL}/wiki`)
    await page.getByRole('button', { name: '新規ページ' }).click()
    await page.getByPlaceholder('ページタイトル').fill(title)
    await page.getByRole('button', { name: '作成', exact: true }).click()
    const editor = page.locator('.bn-editor')
    await expect(editor).toBeVisible({ timeout: 20000 })
    await expect(page).toHaveURL(/[?&]page=/)

    try {
      // 本文を書く（`# ` `## ` で見出しになる）
      await editor.click()
      await page.keyboard.type('# はじめに')
      await page.keyboard.press('Enter')
      for (let i = 1; i <= FILLER_LINES; i++) {
        await page.keyboard.type(`段落 ${i}`)
        await page.keyboard.press('Enter')
      }
      await page.keyboard.type(`## ${target}`)
      await page.keyboard.press('Enter')
      for (let i = 1; i <= 10; i++) {
        await page.keyboard.type(`後ろの段落 ${i}`)
        await page.keyboard.press('Enter')
      }
      await expect(page.getByText('保存済み')).toBeVisible({ timeout: 20000 })

      // 1. # 付きで開き直すと、見出しが画面に入る（最初の画面の外にある見出し）
      const pageUrl = new URL(page.url())
      const pageId = pageUrl.searchParams.get('page')
      expect(pageId).toBeTruthy()
      await page.goto(`${SPACE_URL}/wiki?page=${pageId}#${encodeURIComponent(anchor)}`)
      const heading = page.locator('.bn-editor h2', { hasText: target })
      await expect(heading).toBeVisible({ timeout: 20000 })
      await expect(heading).toBeInViewport({ timeout: 10000 })
      await expect(page.locator('.bn-editor h1', { hasText: 'はじめに' })).not.toBeInViewport()

      // 2. マウスを乗せるとボタンが出て、押すと見出しへの URL がコピーされる
      await heading.hover()
      const button = page.locator('[data-testid="heading-link-copy"][data-visible="true"]')
      await expect(button).toHaveCount(1)
      await expect(button).toHaveAccessibleName('見出しへのリンクをコピー')
      await button.click()
      await expect(page.getByText('リンクをコピーしました')).toBeVisible()
      const copied = await page.evaluate(() => navigator.clipboard.readText())
      expect(copied).toBe(
        `${title} §${target}\n${pageUrl.origin}${pageUrl.pathname}?page=${pageId}#${encodeURIComponent(anchor)}`
      )
    } finally {
      // 後片付け: ページを消す（右のページ情報パネルから）
      await page.goto(`${SPACE_URL}/wiki?page=${new URL(page.url()).searchParams.get('page')}&info=1`)
      await page.getByRole('button', { name: 'ページを削除' }).first().click()
      await page.getByRole('button', { name: '削除する' }).click()
      await page.waitForLoadState('networkidle')
    }
  })
})
