import { test, expect } from './fixtures'
import { createAdminDb } from './adminDb'

// 目次ブロック（`doc-toc`）は、押したときのスクロールと文字の大きさが実ブラウザでしか
// 測れない。jsdom では `scrollIntoView` も `getComputedStyle` の font-size も当てにならず、
// #980 で入れてから一度も画面で確かめていなかった。ここで次の4つを固定する。
//   1. 「/」の一覧に「目次」が出て、押すと目次ブロックが入る
//   2. 目次の項目数が、そのページの見出しの数と合う
//   3. 項目を押すと、その見出しが画面に入る
//   4. 見出しを足すと、目次もその場で増える（開き直さなくてよい）
//
// 確かめるためのページはデモ組織に作り、終わったら消す。既存のページに打って Ctrl+Z で
// 戻す形は、戻す数を間違えると本文を壊す（議事録で実際に起きた）ので使わない。

const ORG_ID = '00000000-0000-0000-0000-000000000001'
const SPACE_ID = '00000000-0000-0000-0000-000000000010'
const SPACE_URL = `/${ORG_ID}/project/${SPACE_ID}`

const text = (t: string) => [{ type: 'text', text: t, styles: {} }]
const heading = (id: string, level: number, t: string) =>
  ({ id, type: 'heading', props: { level }, content: text(t), children: [] })
const para = (id: string, t: string) => ({ id, type: 'paragraph', props: {}, content: text(t), children: [] })

// 最後の見出しは画面の外に置く（押したときに本当にスクロールするかを見るため）
const FILLER = Array.from({ length: 40 }, (_, i) => para(`e2e-fill-${i}`, `本文の行 ${i + 1}`))
const BODY = [
  { id: 'e2e-top', type: 'paragraph', props: {}, content: [], children: [] },
  heading('e2e-h1', 1, '目次の確認 はじめに'),
  para('e2e-p1', '最初の段落'),
  heading('e2e-h2', 2, '目次の確認 途中'),
  ...FILLER,
  heading('e2e-h3', 2, '目次の確認 おわりに'),
  para('e2e-p2', '最後の段落'),
]
const HEADING_COUNT = 3

let pageId: string | null = null

test.beforeAll(async () => {
  const db = createAdminDb()
  // 作った人はデモ組織の既存ページの作成者に合わせる（誰かの名前で作らないと入らない）
  const { data: any } = await db.from('wiki_pages').select('created_by').eq('space_id', SPACE_ID).limit(1).single()
  if (!any) throw new Error('デモ組織に Wiki ページが1つも無い')
  const { data, error } = await db
    .from('wiki_pages')
    .insert({
      org_id: ORG_ID,
      space_id: SPACE_ID,
      title: '【E2E】目次の確認（自動で消える）',
      body: JSON.stringify(BODY),
      created_by: any.created_by,
      updated_by: any.created_by,
    })
    .select('id')
    .single()
  if (error) throw error
  pageId = data.id
})

test.afterAll(async () => {
  if (pageId) await createAdminDb().from('wiki_pages').delete().eq('id', pageId)
})

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

test('Wiki の目次ブロック: 「/」から入れられて、見出しを拾い、押すとその見出しへ飛ぶ', async ({ page }) => {
  await page.goto(`${SPACE_URL}/wiki?page=${pageId}`)
  // 同時編集の組織では、本文がそろってから書ける状態になる
  const editor = page.locator('.bn-editor[contenteditable="true"]')
  await expect(editor).toBeVisible({ timeout: 20000 })

  // 先頭の空の行で「/」を打つ
  await editor.locator('.bn-inline-content').first().click()
  await pickFromSlashMenu(page, '目次')

  // 1・2. 目次が入り、見出しの数と項目の数が合う
  const toc = page.getByTestId('doc-toc')
  await expect(toc).toBeVisible({ timeout: 10000 })
  await expect(toc).toContainText('目次')
  const items = page.getByTestId('doc-toc-item')
  await expect(items).toHaveCount(HEADING_COUNT)

  // 文字は本文より小さい（text-xs）。「フォントサイズを下げたい」が出発点の要件
  const tocFont = await items.first().evaluate(el => parseFloat(getComputedStyle(el).fontSize))
  const bodyFont = await editor.getByText('最初の段落').evaluate(el => parseFloat(getComputedStyle(el).fontSize))
  expect(tocFont).toBeLessThan(bodyFont)

  // 3. 最後の項目を押すと、画面の外にあった見出しが画面に入る
  const target = editor.getByRole('heading', { name: '目次の確認 おわりに', exact: true })
  await expect(target).not.toBeInViewport()
  await items.last().click()
  await expect(target).toBeInViewport({ timeout: 10000 })

  // 4. 見出しを足すと、目次もその場で増える
  await editor.getByText('最後の段落').click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('## 目次の自動更新の確認')
  await expect(items).toHaveCount(HEADING_COUNT + 1, { timeout: 10000 })
})
