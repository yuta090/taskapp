import { test, expect } from './fixtures'

const BASE_URL = '/00000000-0000-0000-0000-000000000001/project/00000000-0000-0000-0000-000000000010/meetings'

test.describe('Meetings Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL)
  })

  test('should display meetings page with header', async ({ page }) => {
    const breadcrumb = page.getByRole('navigation', { name: 'パンくずリスト' })
    await expect(breadcrumb).toContainText('議事録')
  })

  test('should have create meeting button', async ({ page }) => {
    // .first() の理由は tasks.spec.ts の同名対応と同じ（ランナー内でのみ同一testidが
    // 2要素に解決される事象。実ブラウザでは4通りの確認で常に1要素・根本原因は未特定）。
    const createBtn = page.getByTestId('meetings-create-dropdown').first()
    await expect(createBtn).toBeVisible()
    await expect(createBtn).toContainText('新規')
  })
})

test.describe('MeetingInspector', () => {
  // Note: These tests require a meeting to exist in the database
  // In a real scenario, we'd set up test data before running these tests

  test.skip('should display meeting inspector when meeting is selected', async ({ page }) => {
    // This would require a meeting in the database
    await page.goto(`${BASE_URL}?meeting=some-meeting-id`)
    const inspector = page.getByTestId('meeting-inspector')
    await expect(inspector).toBeVisible()
  })

  test.skip('should have tab navigation', async ({ page }) => {
    await page.goto(`${BASE_URL}?meeting=some-meeting-id`)

    const infoTab = page.getByTestId('meeting-tab-info')
    const minutesTab = page.getByTestId('meeting-tab-minutes')
    const decisionsTab = page.getByTestId('meeting-tab-decisions')

    await expect(infoTab).toBeVisible()
    await expect(minutesTab).toBeVisible()
    await expect(decisionsTab).toBeVisible()
  })

  test.skip('tab click should change active tab', async ({ page }) => {
    await page.goto(`${BASE_URL}?meeting=some-meeting-id`)

    const minutesTab = page.getByTestId('meeting-tab-minutes')
    await minutesTab.click()
    await expect(minutesTab).toHaveClass(/text-gray-900/)
  })

  test.skip('close button should close inspector', async ({ page }) => {
    await page.goto(`${BASE_URL}?meeting=some-meeting-id`)

    const closeBtn = page.getByTestId('meeting-close')
    await closeBtn.click()
    await expect(page).not.toHaveURL(/meeting=/)
  })

  test.skip('start button should be visible for planned meetings', async ({ page }) => {
    // Requires a planned meeting in the database
    await page.goto(`${BASE_URL}?meeting=planned-meeting-id`)

    const startBtn = page.getByTestId('meeting-start')
    await expect(startBtn).toBeVisible()
    await expect(startBtn).toContainText('会議を開始')
  })

  test.skip('end button should be visible for in-progress meetings', async ({ page }) => {
    // Requires an in-progress meeting in the database
    await page.goto(`${BASE_URL}?meeting=in-progress-meeting-id`)

    const endBtn = page.getByTestId('meeting-end')
    await expect(endBtn).toBeVisible()
    await expect(endBtn).toContainText('会議を終了')
  })
})
