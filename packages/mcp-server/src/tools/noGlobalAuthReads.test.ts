import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * ⚠ テナント分離の見張り。
 *
 * 認証コンテキストは呼び出しごとのストア（config.ts の AsyncLocalStorage）から読む。
 * 1箇所でもモジュールの共有変数を直接読むと、**前の呼び出しの利用者・組織が混ざる**。
 * 直列化ロックを外した今、これは「別の組織のデータが見える」に直結する。
 *
 * 新しいツールを足すときは:
 *   利用者 → requireActorUserId()（auth/scope.ts）
 *   組織・範囲 → getAuthContext()（config.ts）
 * を使うこと。`config.actorId` などの直読みはここで落ちる。
 */

const TOOLS_DIR = join(import.meta.dirname, '.')

/** 直読みを禁じる名前 */
const FORBIDDEN = [
  /\bconfig\.actorId\b/,
  /\bconfig\.orgId\b/,
  /\bconfig\.spaceId\b/,
  /\bconfig\.authContext\b/,
]

function toolSourceFiles(): string[] {
  return readdirSync(TOOLS_DIR)
    .filter((f) => f.endsWith('.ts') && !f.includes('.test.') && !f.startsWith('._'))
    .map((f) => join(TOOLS_DIR, f))
    .filter((p) => statSync(p).isFile())
}

describe('ツールは共有の認証情報を直接読まない', () => {
  it('config.actorId / orgId / spaceId / authContext の直読みが無い', () => {
    const violations: string[] = []

    for (const path of toolSourceFiles()) {
      const lines = readFileSync(path, 'utf8').split('\n')
      lines.forEach((line, i) => {
        // コメント内の言及は許す（「使わない」と書いてある説明が実際にある）。
        // 1行の /** … */ ・ 行頭の * ・ // の3種を落とす
        const code = line
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\*.*$/, '')
          .replace(/\/\/.*$/, '')
        if (FORBIDDEN.some((re) => re.test(code))) {
          violations.push(`${path.split('/').pop()}:${i + 1}: ${line.trim()}`)
        }
      })
    }

    expect(violations, `共有の認証情報を直接読んでいる（呼び出しごとのストアから読むこと）:\n${violations.join('\n')}`).toEqual([])
  })

  it('見張りが効いていること（わざと違反する文字列は検出される）', () => {
    const sample = '      created_by: config.actorId,'
    expect(FORBIDDEN.some((re) => re.test(sample))).toBe(true)
  })
})
