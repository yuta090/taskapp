import { test, expect } from './fixtures'

/**
 * プリセット（テンプレート）適用フローのE2E。
 *
 * 共有Supabaseは本番兼用（docs/memory: shared-db-migration-ops）のため、
 * 既定では /api/spaces/create-with-preset をインターセプトしてDBを汚さずに
 * 「ピッカー → プレビュー → 作成 → 遷移」のUIフローを通しで検証する。
 *
 * 実DBまで通す本物の作成テストは E2E_REAL_CREATE=1 のときだけ実行される
 * （テストデータが残るため、手動実行専用）。
 */

const ORG_ID = '00000000-0000-0000-0000-000000000001'
const EXISTING_SPACE = `/${ORG_ID}/project/00000000-0000-0000-0000-000000000010`

test.describe('プロジェクト作成のテンプレート選択フロー', () => {
  test('ピッカー→プレビュー→作成APIが正しいbodyで呼ばれ、新スペースへ遷移する', async ({ page }) => {
    let capturedBody: Record<string, unknown> | null = null

    await page.route('**/api/spaces/create-with-preset', async (route) => {
      capturedBody = route.request().postDataJSON()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          space: {
            id: '00000000-0000-0000-0000-0000000000e2',
            name: 'E2Eテスト案件',
            preset_genre: 'design',
            org_id: ORG_ID,
          },
          milestonesCreated: 5,
          wikiPagesCreated: 4,
        }),
      })
    })

    await page.goto(EXISTING_SPACE)

    // LeftNavの「新しいプロジェクト」ボタンでシートを開く
    await page.getByTitle('新しいプロジェクト').click()
    await expect(page.getByText('新しいプロジェクトを作成')).toBeVisible()

    // Step1: 9ジャンル＋白紙のカードが並ぶ
    await expect(page.getByText('Web/アプリ開発')).toBeVisible()
    await expect(page.getByText('白紙から始める')).toBeVisible()

    // デザイン制作を選択
    await page.getByRole('button', { name: /デザイン制作/ }).click()

    // Step2: プレビューに作成内容と推奨連携が出る
    await expect(page.getByText('作成されるもの')).toBeVisible()
    await expect(page.getByText(/デザインブリーフ/)).toBeVisible()
    await expect(page.getByText(/ヒアリング → コンセプト → 制作/)).toBeVisible()

    // 名前を入れて作成
    await page.getByLabel('プロジェクト名').fill('E2Eテスト案件')
    await page.getByRole('button', { name: '作成', exact: true }).click()

    // APIに正しいbodyが渡る
    await expect
      .poll(() => capturedBody)
      .toEqual({ name: 'E2Eテスト案件', presetGenre: 'design', orgId: ORG_ID })

    // 新スペースへ遷移
    await page.waitForURL(`**/${ORG_ID}/project/00000000-0000-0000-0000-0000000000e2**`)
  })

  test('白紙プリセットを選ぶとプレビューなしで作成に進める', async ({ page }) => {
    await page.route('**/api/spaces/create-with-preset', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          space: { id: '00000000-0000-0000-0000-0000000000e3', org_id: ORG_ID },
          milestonesCreated: 0,
          wikiPagesCreated: 0,
        }),
      }),
    )

    await page.goto(EXISTING_SPACE)
    await page.getByTitle('新しいプロジェクト').click()
    await page.getByRole('button', { name: /白紙から始める/ }).click()

    // 白紙はプレビュー（作成されるもの）が出ない
    await expect(page.getByText('作成されるもの')).not.toBeVisible()

    await page.getByLabel('プロジェクト名').fill('白紙プロジェクト')
    await page.getByRole('button', { name: '作成', exact: true }).click()
    await page.waitForURL(`**/project/00000000-0000-0000-0000-0000000000e3**`)
  })

  test('API失敗時はエラーを表示しシートに留まる', async ({ page }) => {
    await page.route('**/api/spaces/create-with-preset', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Failed to create space' }),
      }),
    )

    await page.goto(EXISTING_SPACE)
    await page.getByTitle('新しいプロジェクト').click()
    await page.getByRole('button', { name: /コンサルティング/ }).click()
    await page.getByLabel('プロジェクト名').fill('失敗ケース')
    await page.getByRole('button', { name: '作成', exact: true }).click()

    await expect(page.getByText('Failed to create space')).toBeVisible()
    // シートは開いたまま（選び直せる）
    await expect(page.getByText('新しいプロジェクトを作成')).toBeVisible()
  })
})

// ---------------------------------------------------------------------------
// 実DB作成テスト（オプトイン・テストデータが残る）
// ---------------------------------------------------------------------------

test.describe('実DBでのプリセット適用（E2E_REAL_CREATE=1のみ）', () => {
  test.skip(process.env.E2E_REAL_CREATE !== '1', 'set E2E_REAL_CREATE=1 to run (leaves data)')

  test('デザイン制作テンプレートでWikiとマイルストーンが実際に生成される', async ({ page }) => {
    const name = `E2E-preset-${Date.now()}`

    await page.goto(EXISTING_SPACE)
    await page.getByTitle('新しいプロジェクト').click()
    await page.getByRole('button', { name: /デザイン制作/ }).click()
    await page.getByLabel('プロジェクト名').fill(name)
    await page.getByRole('button', { name: '作成', exact: true }).click()

    // 新スペースへ遷移
    await page.waitForURL(new RegExp(`/${ORG_ID}/project/(?!00000000).+`), { timeout: 30_000 })

    // Wikiにテンプレページが生成されている
    await page.goto(page.url().replace(/\/$/, '') + '/wiki')
    await expect(page.getByText('デザインブリーフ')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('スタイルガイド')).toBeVisible()
    await expect(page.getByText('プロジェクトホーム')).toBeVisible()
  })
})
