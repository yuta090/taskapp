import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

// DESIGN_SYSTEM.md 3.2 Font Weight: 使用可能ウェイトは
// font-normal(400) / font-medium(500) / font-semibold(600) の3段階のみ。
// font-bold(700)・font-black(900) は規格外（日本語グリフでは特に潰れて見える）。
// LP（components/lp 等）はデザインシステム適用除外のため対象外。

const SRC = path.resolve(__dirname, '../..')
const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8')

const FORBIDDEN_WEIGHTS = /font-bold|font-extrabold|font-black/

/** dir配下の .tsx をSRC相対パスで再帰列挙 */
function listTsxFiles(relDir: string): string[] {
  const abs = path.join(SRC, relDir)
  const out: string[] = []
  for (const entry of readdirSync(abs)) {
    const child = path.join(abs, entry)
    if (statSync(child).isDirectory()) {
      out.push(...listTsxFiles(path.join(relDir, entry)))
    } else if (entry.endsWith('.tsx')) {
      out.push(path.join(relDir, entry))
    }
  }
  return out
}

// クライアントに見えるポータル全体（app/portal + components/portal）を対象にする
const PORTAL_FILES = [
  ...listTsxFiles('app/portal'),
  ...listTsxFiles('components/portal'),
]

describe('design tokens: フォントウェイト階層（ポータル全体）', () => {
  it('対象ファイルが列挙されている（globの空振り防止）', () => {
    expect(PORTAL_FILES.length).toBeGreaterThan(30)
  })

  it.each(PORTAL_FILES)(
    '%s は font-bold / font-black を使わない（normal/medium/semibold の3段階）',
    (rel) => {
      const src = read(rel)
      const match = src.match(FORBIDDEN_WEIGHTS)
      expect(match, `規格外ウェイト "${match?.[0]}" が残っています`).toBeNull()
    },
  )
})
