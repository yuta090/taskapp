import { test, expect } from '@playwright/test'

const BASE_URL = '/00000000-0000-0000-0000-000000000001/project/00000000-0000-0000-0000-000000000010'

test.describe('Tasks Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL)
  })

  test('should display tasks page with header', async ({ page }) => {
    const breadcrumb = page.getByRole('navigation', { name: 'パンくずリスト' })
    await expect(breadcrumb).toContainText('タスク')
  })

  test('should have filter buttons', async ({ page }) => {
    const allButton = page.getByTestId('tasks-filter-all')
    const activeButton = page.getByTestId('tasks-filter-active')
    const backlogButton = page.getByTestId('tasks-filter-backlog')

    await expect(allButton).toBeVisible()
    await expect(activeButton).toBeVisible()
    await expect(backlogButton).toBeVisible()
  })

  test('filter buttons should toggle active state', async ({ page }) => {
    const allButton = page.getByTestId('tasks-filter-all')
    const activeButton = page.getByTestId('tasks-filter-active')

    // Default: "all" is active
    await expect(allButton).toHaveClass(/bg-white shadow-sm/)

    // Click active filter
    await activeButton.click()
    await expect(page).toHaveURL(/filter=active/)
    await expect(activeButton).toHaveClass(/bg-white shadow-sm/)
  })

  test('clicking "all" filter should clear filter param', async ({ page }) => {
    const allButton = page.getByTestId('tasks-filter-all')
    const activeButton = page.getByTestId('tasks-filter-active')

    await activeButton.click()
    await expect(page).toHaveURL(/filter=active/)

    await allButton.click()
    await expect(page).not.toHaveURL(/filter=/)
  })
})

test.describe('LeftNav', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL)
  })

  test('should display workspace button', async ({ page }) => {
    const workspaceBtn = page.getByTestId('leftnav-workspace')
    await expect(workspaceBtn).toBeVisible()
    await expect(workspaceBtn).toContainText('アルカラ株式会社')
  })

  test('should display quick create button', async ({ page }) => {
    const createBtn = page.getByTestId('leftnav-quick-create')
    await expect(createBtn).toBeVisible()
  })

  test('quick create button should open task create sheet', async ({ page }) => {
    const createBtn = page.getByTestId('leftnav-quick-create')
    await createBtn.click()
    await expect(page).toHaveURL(/create=1/)
    // Verify sheet is actually visible
    const sheet = page.getByTestId('task-create-sheet')
    await expect(sheet).toBeVisible()
  })

  test('should navigate to inbox', async ({ page }) => {
    await page.getByRole('link', { name: '受信トレイ' }).click()
    await expect(page).toHaveURL('/inbox')
  })

  test('should navigate to my tasks', async ({ page }) => {
    await page.getByRole('link', { name: 'マイタスク' }).click()
    await expect(page).toHaveURL('/my')
  })
})

test.describe('TaskCreateSheet', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE_URL}?create=1`)
  })

  test('should display task create sheet when create=1', async ({ page }) => {
    const sheet = page.getByTestId('task-create-sheet')
    await expect(sheet).toBeVisible()
  })

  test('should have title input focused', async ({ page }) => {
    const titleInput = page.getByTestId('task-create-title')
    await expect(titleInput).toBeFocused()
  })

  test('submit button should be disabled when title is empty', async ({ page }) => {
    const submitBtn = page.getByTestId('task-create-submit')
    await expect(submitBtn).toBeDisabled()
  })

  test('submit button should be enabled when title is filled', async ({ page }) => {
    const titleInput = page.getByTestId('task-create-title')
    const submitBtn = page.getByTestId('task-create-submit')

    await titleInput.fill('テストタスク')
    await expect(submitBtn).toBeEnabled()
  })

  test('cancel button should close sheet', async ({ page }) => {
    const cancelBtn = page.getByTestId('task-create-cancel')
    await expect(cancelBtn).toBeVisible()

    await cancelBtn.click()

    // Wait for URL to not include create parameter
    await expect(page).not.toHaveURL(/create=/, { timeout: 10000 })

    // Wait for sheet to be detached from DOM
    const sheet = page.getByTestId('task-create-sheet')
    await expect(sheet).not.toBeVisible()
  })

  test('ESC key should close sheet', async ({ page }) => {
    const sheet = page.getByTestId('task-create-sheet')
    await expect(sheet).toBeVisible()
    await page.keyboard.press('Escape')
    // Wait for sheet to be detached from DOM
    await expect(sheet).not.toBeVisible({ timeout: 10000 })
  })

  // NOTE: The manual task/spec type selector was removed from the create sheet.
  // Type is now auto-derived from whether a Wiki spec page is linked
  // (see TaskCreateSheet.tsx: `wikiPageId ? 'spec' : 'task'`), so the former
  // "type selector should toggle between task and spec" test is obsolete and
  // has been removed.

  test('ball selector should toggle between internal and client', async ({ page }) => {
    const internalBtn = page.getByTestId('task-create-ball-internal')
    const clientBtn = page.getByTestId('task-create-ball-client')

    // Wait for sheet to be fully loaded
    await expect(internalBtn).toBeVisible()
    await expect(clientBtn).toBeVisible()

    // Default: internal is selected with gray-100 background
    await expect(internalBtn).toHaveClass(/bg-gray-100/)

    // Click client button
    await clientBtn.click()

    // Client is now selected with amber-50 background
    await expect(clientBtn).toHaveClass(/bg-amber-50/)
  })
})
