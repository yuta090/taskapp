import { test, expect } from './fixtures'
import type { Page } from '@playwright/test'

// Wiki の同時編集（COEDITING_SPEC 11章）を実ブラウザで通す。jsdom では Realtime の
// private チャネル・BlockNote と Yjs の合流・書記1人の保存を通しで確かめられない。
//   1. 同じページを2つのタブで開く（同じ人でもタブごとに別の参加者として数える）
//   2. 片方で打った文字が、もう片方に出る
//   3. 両方で交互に打っても、競合の帯が出ない
//   4. 保存されて、開き直すと両方の文字が残っている
//
// 同時編集は組織ごとに有効にする（NEXT_PUBLIC_COLLAB_MINUTES_ORG_IDS）。**デモ組織を入れて
// ビルドしたサーバーでだけ回す**（本番の agentpm.app はデモ組織を入れていないので飛ばす）:
//   NEXT_PUBLIC_COLLAB_MINUTES_ORG_IDS=00000000-0000-0000-0000-000000000001 npm run build:local
//   E2E_COLLAB=1 npx playwright test tests/e2e/wiki-coediting.spec.ts
// 作ったページは最後に消す（デモ組織のデータを汚さない）。

const SPACE_URL = '/00000000-0000-0000-0000-000000000001/project/00000000-0000-0000-0000-000000000010'

/** 本文の中の、ある文字を含む段落 */
function editorText(page: Page, text: string) {
  return page.locator('.wiki-editor .bn-editor').getByText(text)
}

/** 本文の末尾に打つ。最後のブロックの終わりにカーソルを置いてから打つ */
async function typeAtEnd(page: Page, text: string) {
  const editor = page.locator('.wiki-editor .bn-editor')
  await editor.locator('.bn-block-content').last().click()
  await page.keyboard.press('End')
  await page.keyboard.type(text, { delay: 20 })
}

/** ある文字の行の末尾に打つ */
async function appendToLine(page: Page, line: string, text: string) {
  await editorText(page, line).click()
  await page.keyboard.press('End')
  await page.keyboard.type(text, { delay: 20 })
}

test.describe('Wiki の同時編集', () => {
  test.skip(!process.env.E2E_COLLAB, 'デモ組織で同時編集を有効にしてビルドしたサーバーでだけ回す')

  test('2つのタブで同じページを書くと互いの文字が見え、競合の帯が出ずに保存される', async ({ page, context }) => {
    const title = `E2E同時編集-${Date.now()}`
    let pageUrl: string | null = null
    try {
      // ページを作る（作ると、そのページが開く）
      await page.goto(`${SPACE_URL}/wiki`)
      await page.getByRole('button', { name: '新規ページ' }).click()
      await page.getByPlaceholder('ページタイトル').fill(title)
      await page.getByRole('button', { name: '作成', exact: true }).click()
      await expect(page.locator('.wiki-editor .bn-editor')).toBeVisible({ timeout: 30000 })
      pageUrl = page.url()

      // 2つ目のタブで同じページを開く
      const other = await context.newPage()
      await other.goto(pageUrl)
      await expect(other.locator('.wiki-editor .bn-editor')).toBeVisible({ timeout: 30000 })
      // 部屋に入り、本文が器に届くまで待つ（書けるようになる）
      await expect(page.locator('.wiki-editor .bn-editor')).toHaveAttribute('contenteditable', 'true', { timeout: 20000 })
      await expect(other.locator('.wiki-editor .bn-editor')).toHaveAttribute('contenteditable', 'true', { timeout: 20000 })

      // 1つ目で打つと、2つ目に出る
      await typeAtEnd(page, 'あいうえおA')
      await expect(editorText(other, 'あいうえおA')).toBeVisible({ timeout: 10000 })
      // 相手が見えている（カーソルの名札）
      await expect(other.locator('.collaboration-cursor__caret, .bn-collaboration-cursor__base').first()).toBeAttached({
        timeout: 10000,
      })

      // 2つ目で改行して打つと、1つ目に出る
      await other.locator('.wiki-editor .bn-editor').getByText('あいうえおA').click()
      await other.keyboard.press('End')
      await other.keyboard.press('Enter')
      await other.keyboard.type('かきくけこB', { delay: 20 })
      await expect(editorText(page, 'かきくけこB')).toBeVisible({ timeout: 10000 })

      // 交互に同じ行の末尾へもう1回ずつ
      await appendToLine(page, 'かきくけこB', 'C')
      await expect(editorText(other, 'かきくけこBC')).toBeVisible({ timeout: 10000 })
      await appendToLine(other, 'かきくけこBC', 'D')
      await expect(editorText(page, 'かきくけこBCD')).toBeVisible({ timeout: 10000 })

      // 保存を待つ（1.5秒の待ち＋通信）。どちらの画面にも競合の帯は出ない
      await page.waitForTimeout(5000)
      await expect(page.getByTestId('wiki-conflict-banner')).toHaveCount(0)
      await expect(other.getByTestId('wiki-conflict-banner')).toHaveCount(0)
      await expect(page.getByTestId('wiki-collab-degraded-notice')).toHaveCount(0)

      // 2つ目を閉じてから1つ目を開き直すと、両方の文字が残っている（列に保存された）
      await other.close()
      await page.waitForTimeout(2000)
      await page.reload()
      await expect(editorText(page, 'あいうえおA')).toBeVisible({ timeout: 30000 })
      await expect(editorText(page, 'かきくけこBCD')).toBeVisible()
      await expect(page.getByTestId('wiki-conflict-banner')).toHaveCount(0)
    } finally {
      // ページを消す（失敗した回も残さない。残すと、一覧の先頭のページを使う別の E2E が狂う）。
      // 消すと一覧に戻るので、一覧から消えたことまで確かめる
      if (pageUrl) {
        await page.goto(pageUrl)
        await page.getByRole('button', { name: 'ページを削除' }).click()
        await page.getByRole('button', { name: '削除する' }).click()
        await expect(page).not.toHaveURL(/[?&]page=/, { timeout: 15000 })
        await expect(page.getByRole('heading', { name: title, exact: true })).toHaveCount(0, { timeout: 15000 })
      }
    }
  })
})
