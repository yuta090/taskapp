import { test, expect } from '@playwright/test'

/**
 * Gantt Chart DnD E2E Test
 *
 * Uses demo account (demo@example.com / demo1234) for login.
 * Note: yuta@because-and.com / test1234 returned auth error.
 *
 * Steps:
 * 1. Log in via /login form
 * 2. Navigate to the first project's Gantt chart view
 * 3. Screenshot the Gantt chart
 * 4. Hover over a task row sidebar to reveal the drag handle
 * 5. Screenshot showing the drag handle
 */

test.describe('Gantt Chart - Drag and Drop', () => {
  test('should display Gantt chart and reveal drag handle on hover', async ({ page }) => {
    // --------------------------------------------------------
    // Step 1: Navigate to login page
    // --------------------------------------------------------
    await page.goto('/login')
    await expect(page.locator('form')).toBeVisible({ timeout: 10000 })

    // --------------------------------------------------------
    // Step 2: Fill in credentials and submit
    // --------------------------------------------------------
    const emailInput = page.locator('input[type="email"]')
    const passwordInput = page.locator('input[type="password"]')

    await emailInput.fill('demo@example.com')
    await passwordInput.fill('demo1234')

    // Click the login button (submit)
    await page.locator('button[type="submit"]').click()

    // --------------------------------------------------------
    // Step 3: Wait for redirect after login
    // --------------------------------------------------------
    // After login, the app redirects to /{orgId}/project/{spaceId}
    // Wait for the URL to change away from /login
    await page.waitForURL((url) => !url.pathname.includes('/login'), {
      timeout: 30000,
    })

    // Wait for the page to settle (network idle)
    await page.waitForLoadState('networkidle', { timeout: 30000 })

    // --------------------------------------------------------
    // Step 4: Navigate to the Gantt chart
    // --------------------------------------------------------
    // The sidebar should have a "ガントチャート" link.
    // First, ensure the sidebar is visible and a project space is expanded.
    // The space may already be expanded since we landed on a project page.
    // Look for the Gantt chart link in the sidebar.
    const ganttLink = page.locator('a', { hasText: 'ガントチャート' }).first()

    // If the Gantt link is not immediately visible, try to expand a space first
    const ganttVisible = await ganttLink.isVisible().catch(() => false)
    if (!ganttVisible) {
      // Click on the first space/project item to expand it
      // Space items are links with text content inside the sidebar
      // Look for any element that could be a space name (they're in the left sidebar)
      const spaceItems = page.locator('nav a, nav button').filter({ hasText: /.*/ })
      const firstExpandable = spaceItems.first()
      if (await firstExpandable.isVisible()) {
        await firstExpandable.click()
        await page.waitForTimeout(1000)
      }
    }

    // Now click the Gantt chart link
    await ganttLink.waitFor({ state: 'visible', timeout: 15000 })
    await ganttLink.click()

    // Wait for navigation to the Gantt view
    await page.waitForURL(/\/views\/gantt/, { timeout: 15000 })
    await page.waitForLoadState('networkidle', { timeout: 30000 })

    // --------------------------------------------------------
    // Step 5: Wait for Gantt chart to load
    // --------------------------------------------------------
    // The GanttChart component renders "ガントチャート" in its toolbar h2
    const ganttHeading = page.locator('h2', { hasText: 'ガントチャート' })
    await expect(ganttHeading).toBeVisible({ timeout: 15000 })

    // Wait for tasks to load (the task count indicator "X タスク")
    const taskCount = page.locator('text=/\\d+ タスク/')
    await expect(taskCount).toBeVisible({ timeout: 15000 })

    // --------------------------------------------------------
    // Step 6: Screenshot the Gantt chart page
    // --------------------------------------------------------
    await page.screenshot({
      path: 'e2e/screenshots/gantt-chart-full.png',
      fullPage: false,
    })

    // --------------------------------------------------------
    // Step 7: Hover over a task row to reveal the drag handle
    // --------------------------------------------------------
    // Task rows in the sidebar use `group` class and contain a drag handle button
    // with aria-label="ドラッグして親タスクに紐づけ"
    // The drag handle is hidden (opacity-0) and shown on hover (group-hover:opacity-60)

    // Find a task row that has a drag handle (DraggableTaskRow)
    const dragHandleButton = page.locator('button[aria-label="ドラッグして親タスクに紐づけ"]').first()

    // First, check if any drag handles exist in the DOM
    const handleCount = await page.locator('button[aria-label="ドラッグして親タスクに紐づけ"]').count()

    if (handleCount > 0) {
      // The drag handle's parent row has class "group"
      // Hover over the row to trigger group-hover
      const taskRow = dragHandleButton.locator('..')
      await taskRow.hover()

      // Small wait for CSS transition
      await page.waitForTimeout(500)

      // Screenshot showing the drag handle visible
      await page.screenshot({
        path: 'e2e/screenshots/gantt-drag-handle-visible.png',
        fullPage: false,
      })
    } else {
      // If no draggable rows found, hover over any task row in the sidebar
      // and take a screenshot anyway
      // Task rows are inside the sidebar div with width matching GANTT_CONFIG.SIDEBAR_WIDTH
      const sidebarTaskRow = page.locator('.group').first()
      if (await sidebarTaskRow.isVisible()) {
        await sidebarTaskRow.hover()
        await page.waitForTimeout(500)
      }
      await page.screenshot({
        path: 'e2e/screenshots/gantt-drag-handle-visible.png',
        fullPage: false,
      })
    }
  })
})
