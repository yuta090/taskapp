// アプリ用の lint（リポジトリ直下の eslint.config.mjs は apps/ を対象外にしている）
const { defineConfig } = require('eslint/config')
const expoConfig = require('eslint-config-expo/flat')

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', '.expo/*'],
  },
])
