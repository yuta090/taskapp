import { createClient } from '@supabase/supabase-js'
import { test, expect } from './fixtures'

// メモの中で Enter を押したら、空の行を足さずにすぐ下の行へ移る（src/components/meeting/minutesBlocks.tsx の
// exitNoteOnEnter）。議事録の「会議メモ」も同じ部品なので、Wiki で確かめる。
// 実際のキー入力の順番（ブラウザの keydown → BlockNote の既定の Enter との優先）は jsdom では
// 確かめきれないので、実ブラウザで固定する。
// 確かめるためのページはデモ組織に作り、終わったら消す（ほかのページの本文には触らない）。

const ORG_ID = '00000000-0000-0000-0000-000000000001'
const SPACE_ID = '00000000-0000-0000-0000-000000000010'
const SPACE_URL = `/${ORG_ID}/project/${SPACE_ID}`

const text = (t: string) => [{ type: 'text', text: t, styles: {} }]
const BODY = [
  { id: 'e2e-note', type: 'meetingNote', props: { createdAt: '', author: '' }, content: text('メモの文'), children: [] },
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
      title: '【E2E】メモの Enter の確認（自動で消える）',
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

test('メモの中で Enter を押すと、行を足さずに下の行の先頭へ移る', async ({ page }) => {
  await page.goto(`${SPACE_URL}/wiki?page=${pageId}`)
  const editor = page.locator('.bn-editor')
  await expect(editor).toBeVisible({ timeout: 20000 })

  await editor.getByText('メモの文').click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  // 移った先に打つ。先頭に入れば「下の行の先頭へ移った」ことになる
  await page.keyboard.type('X')

  await expect(editor.getByText('X次の行')).toBeVisible()
  // BlockNote は本文の末尾に空の行を自分で置くので、それは数えない。メモと次の行のあいだに空行が無いこと
  const lines = await editor.locator('.bn-inline-content').allInnerTexts()
  while (lines.length && lines.at(-1)!.trim() === '') lines.pop()
  expect(lines).toEqual(['メモの文', 'X次の行'])
})
