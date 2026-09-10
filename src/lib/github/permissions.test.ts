import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { GITHUB_APP_PERMISSIONS, GITHUB_APP_EVENTS } from './permissions.mjs'

/**
 * 許可範囲・購読イベントの正本は `permissions.mjs` の1か所だけ
 * （GITHUB_ISSUES_LINK_SPEC.md §7.6・§9 PR0b）。
 *
 * `config.ts`（Next にバンドルされる側）と `scripts/setup-github-app.mjs`
 * （マニフェストで GitHub App を作る CLI）の両方がここから読む。ずれたら
 * このテストが落ちる。
 */

const REPO_ROOT = path.resolve(__dirname, '../../..')

describe('GitHub App permissions/events の正本', () => {
  it('確定値どおり: pull_requests=read, issues=write, metadata=read', () => {
    expect(GITHUB_APP_PERMISSIONS).toEqual({
      pull_requests: 'read',
      issues: 'write',
      metadata: 'read',
    })
  })

  it('確定値どおり: events は pull_request と issues だけ（installation系は含めない）', () => {
    expect(GITHUB_APP_EVENTS).toEqual(['pull_request', 'issues'])
  })

  it('contents:read は使用箇所が無いので含まない', () => {
    expect(JSON.stringify(GITHUB_APP_PERMISSIONS)).not.toMatch(/contents/)
  })

  it('config.ts の requiredPermissions は正本と一致する', async () => {
    const { GITHUB_CONFIG } = await import('./config')
    expect(GITHUB_CONFIG.requiredPermissions).toEqual(GITHUB_APP_PERMISSIONS)
  })

  it('scripts/setup-github-app.mjs のマニフェストは正本を import して使っている（ハードコードしていない）', () => {
    const source = readFileSync(path.join(REPO_ROOT, 'scripts/setup-github-app.mjs'), 'utf8')

    expect(source).toMatch(
      /import\s*\{\s*GITHUB_APP_PERMISSIONS\s*,\s*GITHUB_APP_EVENTS\s*\}\s*from\s*['"].*permissions\.mjs['"]/,
    )
    expect(source).toMatch(/default_permissions:\s*GITHUB_APP_PERMISSIONS/)
    expect(source).toMatch(/default_events:\s*(\[\.\.\.)?GITHUB_APP_EVENTS/)
    // ハードコードした許可範囲に後戻りしていないこと
    expect(source).not.toMatch(/default_permissions:\s*\{/)
  })
})
