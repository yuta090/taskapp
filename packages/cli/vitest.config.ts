import { defineConfig, configDefaults } from 'vitest/config'

// cli 単体のテスト設定。ルート(vitest.config.ts)は src/** しか拾わないため、
// このパッケージのテストは `cd packages/cli && npx vitest run` で回す。
export default defineConfig({
  // 親ディレクトリの postcss.config.mjs(Next用)を Vite が拾って落ちるのを防ぐ（CSSは扱わない）
  css: { postcss: {} },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // exFAT 上で macOS が作る AppleDouble(._*) を除外する（ルート設定と同じ理由）
    exclude: [...configDefaults.exclude, '**/._*', 'dist/**'],
  },
})
