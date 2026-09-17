import { test, expect } from './fixtures'

/**
 * CSV を表で開いて、その場で直せることの通し確認。
 *
 * ここだけは単体テストでは確かめられない:
 * - 実際に Storage へ書き戻せているか（再読み込みして値が残っているか）
 * - 保存の基準の版（X-Base-Updated-At）が実物の files.updated_at と噛み合うか
 *
 * デモ用のスペースに**このテストが作ったファイル**を上げて直し、最後に消す。
 * 実在の資料には触らない。
 */

const DEMO_ORG = '00000000-0000-0000-0000-000000000001'
const DEMO_SPACE = '00000000-0000-0000-0000-000000000010'
const FILES_URL = `/${DEMO_ORG}/project/${DEMO_SPACE}/files`

// 同時に走らせても衝突しないよう、名前を実行ごとに変える
const FILE_NAME = `e2e-table-edit-${Date.now()}.csv`
const CSV = '会社名,都道府県,商談件数\nＡ社,広島県,1\nＢ社,島根県,0\n'

test.describe('ファイル: CSV をその場で直す', () => {
  test('アップロード → 表で開く → セルを直す → 再読み込みしても残っている', async ({ page }) => {
    await page.goto(FILES_URL)

    // --- アップロード ---
    await page.getByTestId('files-input').setInputFiles({
      name: FILE_NAME,
      mimeType: 'text/csv',
      buffer: Buffer.from(CSV, 'utf-8'),
    })

    const fileLink = page.getByRole('link', { name: FILE_NAME })
    await expect(fileLink).toBeVisible()

    // --- 表で開く ---
    await fileLink.click()
    await expect(page).toHaveURL(/\/files\/[0-9a-f-]{36}$/)
    const tablePath = new URL(page.url()).pathname

    await expect(page.getByRole('columnheader', { name: /会社名/ })).toBeVisible()
    const firstCell = page.getByRole('cell').first()
    await expect(firstCell).toHaveText('Ａ社')

    // 社内メンバーなので直せる操作が出ている
    await expect(page.getByRole('button', { name: '行を追加' })).toBeVisible()

    // --- セルを直す（保存ボタンは無い。手が止まると保存される） ---
    await firstCell.click()
    const cellInput = page.getByRole('textbox', { name: 'セルの中身' })
    await expect(cellInput).toBeVisible()
    await cellInput.fill('Ｃ社')
    await cellInput.press('Enter')

    await expect(page.getByText('保存しました')).toBeVisible()

    // --- 再読み込みしても残っているか（＝Storage に書けているか） ---
    await page.goto(tablePath)
    await expect(page.getByRole('cell').first()).toHaveText('Ｃ社')

    // --- 後片付け: テストが作ったファイルを消す ---
    await page.goto(FILES_URL)
    await page.getByTestId('files-search').fill(FILE_NAME)
    const row = page.locator('[data-testid^="file-delete-"]').first()
    await row.click()
    await page.getByRole('button', { name: '削除', exact: true }).click()
    await expect(page.getByRole('link', { name: FILE_NAME })).toHaveCount(0)
  })
})
