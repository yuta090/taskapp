import { createClient } from '@supabase/supabase-js'
import { test, expect } from './fixtures'

// Wiki のフォルダ（PR5）を実ブラウザで一通り触る。jsdom では HTML5 のドラッグ＆ドロップと
// 確認ダイアログの流れを通しで確かめられないので、ここで固定する。
//   1. 「新しいフォルダ」で作ると、フォルダのアイコン付きで一覧に出る
//   2. フォルダを別のフォルダの上へドラッグすると、その中に入る（字下げされる）
//   3. 「…」→「名前を変更」でその場で名前を変えられる
//   4. 「…」→「削除」で確認をはさみ、中身は1つ上の階層へ戻る
// 作ったフォルダは最後に消す（デモ組織のデータを汚さない）。
// 画面での後片付けは途中で落ちると走らないので、前後に管理用の鍵でも消す。
// 前の回の残りがあると一覧の並びが変わり、取り違えの元になるため。

const ORG_ID = '00000000-0000-0000-0000-000000000001'
const SPACE_ID = '00000000-0000-0000-0000-000000000010'
const SPACE_URL = `/${ORG_ID}/project/${SPACE_ID}`
const TITLE_PREFIX = 'E2Eフォルダ'

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が .env.local に無い')
  return createClient(url, key, { auth: { persistSession: false } })
}

/**
 * このテストが作るフォルダ（題名が TITLE_PREFIX で始まるもの）を消す。
 * stamp を渡すとその回で作ったものだけ、渡さないと10分以上前の残りだけを消す
 * （同時に走っている別の回のフォルダまで消すと、そちらが落ちる）。
 */
async function removeTestFolders(stamp?: number) {
  const db = admin()
  let query = db.from('wiki_pages').select('id').eq('space_id', SPACE_ID)
  query = stamp
    ? query.like('title', `${TITLE_PREFIX}%-${stamp}`)
    : query.like('title', `${TITLE_PREFIX}%`).lt('created_at', new Date(Date.now() - 10 * 60 * 1000).toISOString())
  const { data, error } = await query
  if (error) throw error
  const ids = (data ?? []).map(r => r.id)
  if (ids.length === 0) return
  // 中に入っていたページは parent_page_id の on delete set null で一番上の階層へ戻る
  const { error: deleteError } = await db.from('wiki_pages').delete().in('id', ids)
  if (deleteError) throw deleteError
}

let stamp = 0

test.beforeEach(async () => {
  stamp = Date.now()
  await removeTestFolders()
})
test.afterEach(async () => {
  await removeTestFolders(stamp)
})

test.describe('Wiki のフォルダ', () => {
  test('作成・ドラッグで移動・名前変更・削除ができる', async ({ page }) => {
    const outer = `${TITLE_PREFIX}外-${stamp}`
    const inner = `${TITLE_PREFIX}内-${stamp}`
    const renamed = `${TITLE_PREFIX}改名-${stamp}`

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
    // 作った直後は仮の行が保存後の行に差し替わる。差し替えの瞬間に読むと、外れた行の値
    // （NaN）が返るので、数が読めるまで待つ
    let before = NaN
    await expect.poll(async () => (before = await paddingOf(inner)), { timeout: 15000 }).not.toBeNaN()
    await rowByTitle(inner).dragTo(rowByTitle(outer))
    await expect.poll(() => paddingOf(inner), { timeout: 15000 }).toBeGreaterThan(before)
    // 字下げだけでは、ほかのフォルダの中に落ちても通ってしまう。outer の直下の行が inner かも見る
    await expect(
      rowByTitle(outer).locator('xpath=following-sibling::*[1]').getByRole('heading', { name: inner, exact: true })
    ).toBeVisible()

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
