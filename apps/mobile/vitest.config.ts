import path from 'path'
import { defineConfig } from 'vitest/config'

// 画面を持たない純粋なロジック（src/lib）だけを Node で検査する。
// React Native の部品を読むファイルはここでは扱わない（読めずに落ちるため）。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '~': path.resolve(__dirname, './src'),
      '@': path.resolve(__dirname, '../../src'),
    },
  },
})
