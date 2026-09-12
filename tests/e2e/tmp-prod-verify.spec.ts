import { test, expect } from './fixtures'
const ORG = '00000000-0000-0000-0000-000000000001'
const SPACE = '00000000-0000-0000-0000-000000000010'
const SHOT = process.env.SHOT_DIR || '/tmp/prod-verify'

test('本番: タスク一覧の既定が「アクティブ」', async ({ page }) => {
  await page.goto(`/${ORG}/project/${SPACE}`)
  const active = page.getByTestId('tasks-filter-active')
  await expect(active).toBeVisible({ timeout: 30_000 })
  await expect(active).toHaveClass(/bg-surface shadow-sm/)
  await expect(page.getByTestId('tasks-filter-all')).not.toHaveClass(/bg-surface shadow-sm/)
  expect(page.url()).not.toContain('filter=')
  await page.screenshot({ path: `${SHOT}/tasks.png` })
})

test('本番: 「/」メニューが中でスクロールする指定が配られている', async ({ page }) => {
  await page.goto(`/${ORG}/project/${SPACE}/wiki`)
  await expect(page.getByRole('button', { name: '新規ページ' })).toBeVisible({ timeout: 30_000 })
  const rules = await page.evaluate(() => {
    const found: string[] = []
    for (const sheet of Array.from(document.styleSheets)) {
      let list: CSSRuleList
      try { list = sheet.cssRules } catch { continue }
      for (const rule of Array.from(list)) {
        const text = rule.cssText
        if (/bn-(grid-)?suggestion-menu/.test(text) && /overflow-y:\s*auto/.test(text)) found.push(text)
      }
    }
    return found
  })
  console.log('[RULES]', JSON.stringify(rules))
  expect(rules.length).toBeGreaterThan(0)
  await page.screenshot({ path: `${SHOT}/wiki.png` })
})
