import { defineConfig } from 'vitest/config'

// worker 専用の隔離設定（親worktreeの app 用 vitest.config を継承しない）。
export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
})
