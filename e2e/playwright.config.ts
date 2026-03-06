import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  timeout: 120000,
  use: {
    baseURL: 'http://localhost:4000',
    trace: 'on',
    screenshot: 'on',
    video: 'retain-on-failure',
    actionTimeout: 15000,
    navigationTimeout: 30000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
