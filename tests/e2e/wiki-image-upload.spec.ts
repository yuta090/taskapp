import { test, expect } from './fixtures'
import { createAdminDb } from './adminDb'

// Wiki の画像アップロード（#1105）。jsdom では BlockNote のアップロード欄も、
// /api/files/<id>/download → Storage の署名URL への転送も動かないので、実ブラウザで次を固定する。
//   1. 「/」→「画像」→ アップロードで、画像がページに表示される（読み込めて幅がある）
//   2. 本文には署名URLでなく、期限の切れない /api/files/<id>/download が残る
//
// 確かめるためのページはデモ組織に作り、終わったらページと上げたファイルを消す。

const ORG_ID = '00000000-0000-0000-0000-000000000001'
const SPACE_ID = '00000000-0000-0000-0000-000000000010'
const SPACE_URL = `/${ORG_ID}/project/${SPACE_ID}`
const FILE_NAME = 'e2e-wiki-image.png'

// 8x8 の赤い PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC',
  'base64'
)
const DOWNLOAD_PATH = /^\/api\/files\/([0-9a-f-]{36})\/download$/

let pageId: string | null = null
const uploadedFileIds: string[] = []

test.beforeAll(async () => {
  const db = createAdminDb()
  const { data: any } = await db.from('wiki_pages').select('created_by').eq('space_id', SPACE_ID).limit(1).single()
  if (!any) throw new Error('デモ組織に Wiki ページが1つも無い')
  const { data, error } = await db
    .from('wiki_pages')
    .insert({
      org_id: ORG_ID,
      space_id: SPACE_ID,
      title: '【E2E】画像アップロードの確認（自動で消える）',
      body: JSON.stringify([{ id: 'e2e-top', type: 'paragraph', props: {}, content: [], children: [] }]),
      created_by: any.created_by,
      updated_by: any.created_by,
    })
    .select('id')
    .single()
  if (error) throw error
  pageId = data.id
})

test.afterAll(async () => {
  const db = createAdminDb()
  if (pageId) await db.from('wiki_pages').delete().eq('id', pageId)
  for (const id of uploadedFileIds) {
    const { data: file } = await db.from('files').select('storage_path').eq('id', id).single()
    if (file?.storage_path) await db.storage.from('space-files').remove([file.storage_path])
    await db.from('files').delete().eq('id', id)
  }
})

test('Wiki の画像: 「/」→「画像」でアップロードすると、ページに表示され、本文には安定したURLが残る', async ({ page }) => {
  await page.goto(`${SPACE_URL}/wiki?page=${pageId}`)
  const editor = page.locator('.bn-editor[contenteditable="true"]')
  await expect(editor).toBeVisible({ timeout: 20000 })

  await editor.locator('.bn-inline-content').first().click()
  await page.keyboard.type('/')
  const menu = page.locator('.bn-suggestion-menu')
  await expect(menu).toBeVisible({ timeout: 10000 })
  await page.keyboard.type('画像')
  await menu.getByText('画像', { exact: true }).first().click()

  // 画像のブロックを入れると、アップロード欄が開く（アップロード先が無い頃は「埋め込み」しか無かった）
  const fileInput = page.locator('input[type="file"]').first()
  await expect(fileInput).toBeAttached({ timeout: 10000 })
  await fileInput.setInputFiles({ name: FILE_NAME, mimeType: 'image/png', buffer: PNG })

  // 1. 画像が表示される（転送先の署名URLまで読めて、幅がある）
  const img = editor.locator('img').first()
  await expect(img).toHaveAttribute('src', DOWNLOAD_PATH, { timeout: 30000 })
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth), { timeout: 30000 })
    .toBeGreaterThan(0)
  const fileId = DOWNLOAD_PATH.exec((await img.getAttribute('src')) ?? '')![1]
  uploadedFileIds.push(fileId)

  // 2. 保存された本文に /api/files/<id>/download が残る（自動保存を待つ）
  const db = createAdminDb()
  await expect
    .poll(
      async () => {
        const { data } = await db.from('wiki_pages').select('body').eq('id', pageId!).single()
        return String(data?.body ?? '')
      },
      { timeout: 30000 }
    )
    .toContain(`/api/files/${fileId}/download`)
})
