import { test as base, expect } from '@playwright/test'

// Onboarding walkthroughs render a full-screen role="dialog" overlay until the
// user dismisses them, which intercepts pointer events and breaks E2E clicks.
// Mark them as already seen before any app script runs so the UI is interactive.
// Keys: src/components/onboarding/InternalOnboardingWalkthrough.tsx,
//       src/components/portal/PortalOnboardingWalkthrough.tsx
const ONBOARDING_KEYS = ['taskapp_internal_onboarded', 'taskapp_portal_onboarded']

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript((keys: string[]) => {
      try {
        for (const key of keys) window.localStorage.setItem(key, 'true')
      } catch {
        // localStorage unavailable (should not happen in Chromium) — ignore
      }
    }, ONBOARDING_KEYS)
    await use(page)
  },
})

export { expect }
