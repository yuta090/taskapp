import { test, expect } from './fixtures'

/**
 * ファイルをチェックしてまとめて削除する通し確認。
 * 実際に API を通ってサーバーから消えることは単体テストでは確かめられない。
 *
 * デモ用のスペースに**このテストが作ったファイル**を上げて消す。実在の資料には触らない。
 */

const DEMO_ORG = '00000000-0000-0000-0000-000000000001'
const DEMO_SPACE = '00000000-0000-0000-0000-000000000010'
const FILES_URL = `/${DEMO_ORG}/project/${DEMO_SPACE}/files`

// 同時に走らせても衝突しないよう、名前を実行ごとに変える
const PREFIX = `e2e-bulk-delete-${Date.now()}`
const NAMES = [`${PREFIX}-a.txt`, `${PREFIX}-b.txt`]

test.describe('ファイル: まとめて削除', () => {
  test('アップロード → 全選択 → 削除 → サーバーからも消えている', async ({ page }) => {
    await page.goto(FILES_URL)

    await page.getByTestId('files-input').setInputFiles(
      NAMES.map((name) => ({ name, mimeType: 'text/plain', buffer: Buffer.from('e2e', 'utf-8') }))
    )
    for (const name of NAMES) {
      await expect(page.getByText(name)).toBeVisible()
    }

    // 自分が上げた2件だけに絞ってから全選択する
    await page.getByTestId('files-search').fill(PREFIX)
    await expect(page.getByTestId('file-row')).toHaveCount(2)
    await page.getByTestId('files-select-all').check()
    await expect(page.getByTestId('files-bulk-bar')).toContainText('2件選択')
    await page.screenshot({ path: test.info().outputPath('bulk-bar.png') })

    await page.getByTestId('files-bulk-delete').click()
    await page.getByRole('alertdialog').getByRole('button', { name: '削除', exact: true }).click()

    await expect(page.getByTestId('file-row')).toHaveCount(0)
    await expect(page.getByTestId('files-bulk-bar')).toHaveCount(0)

    // サーバーから消えたことは API で確かめる。削除の直後に開き直すと、IDB へ書き戻す前の
    // 永続キャッシュが復元されて行が見えることがあり、画面では判定できない
    const res = await page.request.get(`/api/files?spaceId=${DEMO_SPACE}&q=${PREFIX}`)
    expect(res.ok()).toBe(true)
    expect((await res.json()).files).toEqual([])
  })
})
