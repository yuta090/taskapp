import { createClient } from '@supabase/supabase-js'
import { test, expect } from './fixtures'

// 折りたたみを Notion と同じ打ち方で作れる（src/components/meeting/minutesBlocks.tsx の toggleListItemSpec）。
// - 「>」＋スペースで折りたたみになる（Wiki では引用が同じ打ち方を取っていた）
// - 題名で Enter を押すと、下にもう1つ折りたたみを作らず中身の行へ移る
// - 「/toggle」で「/」メニューに折りたたみが出る
// 入力ルールと既定の Enter との優先は jsdom では確かめきれないので、実ブラウザで固定する。
// 確かめるためのページはデモ組織に作り、終わったら消す（ほかのページの本文には触らない）。

const ORG_ID = '00000000-0000-0000-0000-000000000001'
const SPACE_ID = '00000000-0000-0000-0000-000000000010'
const SPACE_URL = `/${ORG_ID}/project/${SPACE_ID}`

const text = (t: string) => [{ type: 'text', text: t, styles: {} }]
const BODY = [
  { id: 'e2e-empty', type: 'paragraph', props: {}, content: [], children: [] },
  { id: 'e2e-next', type: 'paragraph', props: {}, content: text('次の行'), children: [] },
]

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が .env.local に無い')
  return createClient(url, key, { auth: { persistSession: false } })
}

let pageId: string | null = null

test.beforeAll(async () => {
  const db = admin()
  // 作った人はデモ組織の既存ページの作成者に合わせる（誰かの名前で作らないと入らない）
  const { data: any } = await db.from('wiki_pages').select('created_by').eq('space_id', SPACE_ID).limit(1).single()
  if (!any) throw new Error('デモ組織に Wiki ページが1つも無い')
  const { data, error } = await db
    .from('wiki_pages')
    .insert({
      org_id: ORG_ID,
      space_id: SPACE_ID,
      title: '【E2E】折りたたみの確認（自動で消える）',
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
  if (pageId) await admin().from('wiki_pages').delete().eq('id', pageId)
})

async function openLine(page: import('@playwright/test').Page, which: 'first' | 'last') {
  await page.goto(`${SPACE_URL}/wiki?page=${pageId}`)
  const editor = page.locator('.bn-editor')
  await expect(editor).toBeVisible({ timeout: 20000 })
  await editor.locator('.bn-inline-content')[which]().click()
  return editor
}

test('「>」＋スペースで折りたたみになり、題名で Enter を押すと中身の行へ移る', async ({ page }) => {
  const editor = await openLine(page, 'first')

  await page.keyboard.type('> ')
  const toggles = editor.locator('[data-content-type="toggleListItem"]')
  await expect(toggles).toHaveCount(1)
  await expect(editor.locator('blockquote')).toHaveCount(0)

  await page.keyboard.type('議題')
  await page.keyboard.press('Enter')
  await page.keyboard.type('中身')

  // 折りたたみは1つのまま。「中身」は折りたたみの子（入れ子の中）に入っている
  await expect(toggles).toHaveCount(1)
  // 本文全体も .bn-block-group なので、2段目の中にあれば子の行
  await expect(editor.locator('.bn-block-group .bn-block-group').getByText('中身')).toBeVisible()
  await expect(editor.locator('.bn-block-group .bn-block-group').getByText('次の行')).toHaveCount(0)
})

test('「/toggle」で折りたたみがメニューに出る', async ({ page }) => {
  // 末尾の空の行（BlockNote が必ず置く）で打つ。前のテストで本文が変わっていても影響しない
  await openLine(page, 'last')

  await page.keyboard.type('/toggle')
  await expect(page.locator('.bn-suggestion-menu-item', { hasText: '折りたたみ' })).toBeVisible()
  await page.keyboard.press('Escape')
})
