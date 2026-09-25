import { createClient } from '@supabase/supabase-js'
import { test, expect } from './fixtures'

// 文書エディタのクリックの足し算（src/components/editor/editorClickBehaviors.ts）と表の文字の大きさ。
// どれも実際のレイアウトと BlockNote の DOM に頼るので jsdom では確かめきれない。実ブラウザで次を固定する。
//   1. 折りたたみの題名の文字をクリックすると開閉する
//   2. 表の文字は本文より小さい（13px）
//   3. 表の列の右の境目をダブルクリックすると、中身に合わせて幅が縮む
// 確かめるためのページはデモ組織に作り、終わったら消す（ほかのページの本文には触らない）。

const ORG_ID = '00000000-0000-0000-0000-000000000001'
const SPACE_ID = '00000000-0000-0000-0000-000000000010'
const SPACE_URL = `/${ORG_ID}/project/${SPACE_ID}`

const text = (t: string) => [{ type: 'text', text: t, styles: {} }]
const BODY = [
  {
    id: 'e2e-toggle',
    type: 'toggleListItem',
    props: { textColor: 'default', backgroundColor: 'default' },
    content: text('折りたたみの題名'),
    children: [{ id: 'e2e-toggle-child', type: 'paragraph', props: {}, content: text('折りたたみの中の行'), children: [] }],
  },
  {
    id: 'e2e-table',
    type: 'table',
    props: { textColor: 'default' },
    content: {
      type: 'tableContent',
      // 1列目はわざと広くしておき、ダブルクリックで縮むことを見る
      columnWidths: [320, null],
      rows: [
        { cells: [text('ID'), text('説明')] },
        { cells: [text('F01'), text('二列目は長い説明の文字を入れておく')] },
      ],
    },
    children: [],
  },
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
      title: '【E2E】折りたたみと表の確認（自動で消える）',
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

test.describe('文書エディタの折りたたみと表', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${SPACE_URL}/wiki?page=${pageId}`)
    await expect(page.locator('.bn-editor')).toBeVisible({ timeout: 20000 })
  })

  test('折りたたみの題名の文字をクリックすると開閉する', async ({ page }) => {
    const child = page.locator('.bn-editor').getByText('折りたたみの中の行')
    await expect(child).toBeHidden()

    await page.locator('.bn-editor').getByText('折りたたみの題名').click()
    await expect(child).toBeVisible()

    // 続けてクリックすると閉じる（ダブルクリックと見なされないよう少し間をあける）
    await page.waitForTimeout(600)
    await page.locator('.bn-editor').getByText('折りたたみの題名').click()
    await expect(child).toBeHidden()
  })

  test('表の文字は本文より小さい', async ({ page }) => {
    const cell = page.locator('.bn-editor td').first()
    await expect(cell).toBeVisible()
    expect(await cell.evaluate(el => getComputedStyle(el).fontSize)).toBe('13px')
  })

  test('列の右の境目をダブルクリックすると、中身に合わせて幅が縮む', async ({ page }) => {
    const firstCol = page.locator('.bn-editor td').first()
    await expect(firstCol).toBeVisible()
    const before = await firstCol.boundingBox()
    expect(before!.width).toBeGreaterThan(250)

    // 境目の上に一度乗せてから押す（ドラッグで幅を変える仕組みも、乗せた位置で境目を決める）
    const x = before!.x + before!.width - 2
    const y = before!.y + before!.height / 2
    await page.mouse.move(x, y)
    await page.mouse.dblclick(x, y)

    await expect.poll(async () => (await firstCol.boundingBox())!.width, { timeout: 5000 }).toBeLessThan(120)
  })
})
