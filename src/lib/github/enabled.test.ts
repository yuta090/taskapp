import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { isGitHubConfigured } from './enabled'

const SRC = path.resolve(__dirname, '../..')

/**
 * GitHub 連携の「使えるか」判定だけを、暗号ライブラリを持ち込まないモジュールに切り出す。
 * config.ts は node の crypto を import しているため、クライアントコンポーネントがそこから
 * import すると crypto の polyfill（約100KB gzip）がブラウザに配られてしまう。
 */
describe('isGitHubConfigured', () => {
  const original = process.env.NEXT_PUBLIC_GITHUB_ENABLED
  afterEach(() => {
    process.env.NEXT_PUBLIC_GITHUB_ENABLED = original
  })

  it('NEXT_PUBLIC_GITHUB_ENABLED が true なら有効', () => {
    process.env.NEXT_PUBLIC_GITHUB_ENABLED = 'true'
    expect(isGitHubConfigured()).toBe(true)
  })

  it('未設定・true 以外なら無効', () => {
    delete process.env.NEXT_PUBLIC_GITHUB_ENABLED
    expect(isGitHubConfigured()).toBe(false)
    process.env.NEXT_PUBLIC_GITHUB_ENABLED = 'false'
    expect(isGitHubConfigured()).toBe(false)
  })
})

describe('クライアントに crypto を配らない', () => {
  it('enabled.ts は crypto を import しない', () => {
    const source = readFileSync(path.join(SRC, 'lib/github/enabled.ts'), 'utf8')
    expect(source).not.toMatch(/from\s+['"](node:)?crypto['"]/)
  })

  it("'use client' のファイルは @/lib/github/config から import しない", () => {
    const clientFiles = [
      'app/(internal)/[orgId]/project/[spaceId]/settings/GitHubRepoSettings.tsx',
      'app/settings/org-integrations/page.tsx',
      'components/github/TaskPRList.tsx',
      'lib/hooks/useGitHub.ts',
    ]
    for (const rel of clientFiles) {
      const source = readFileSync(path.join(SRC, rel), 'utf8')
      expect(source, rel).toMatch(/^'use client'/)
      expect(source, rel).not.toMatch(/from\s+['"]@\/lib\/github\/config['"]/)
    }
  })
})
