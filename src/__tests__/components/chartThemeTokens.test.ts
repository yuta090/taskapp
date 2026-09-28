/**
 * ガント・バーンダウンの色は全て CSS 変数（--gantt-* / --burndown-*）経由で持つ。
 * SVG は Tailwind の utility が効かないため、色は constants.ts が var() 参照を返し、
 * ライト/ダークの実値は globals.css の :root / .dark で切り替える。
 * ここで「hex の直書きが残っていないか」「片方のテーマで定義漏れがないか」を機械的に検査する。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { GANTT_CONFIG } from '@/lib/gantt/constants'
import { BURNDOWN_CONFIG } from '@/lib/burndown/constants'

const ROOT = process.cwd()
const CSS = readFileSync(join(ROOT, 'src/app/globals.css'), 'utf8')

/** :root / .dark それぞれで定義されている変数名を集める */
function varsIn(selector: string, prefix: string): Set<string> {
  const re = new RegExp(`(^|\\n)${selector}\\s*\\{([\\s\\S]*?)\\n\\}`, 'g')
  const names = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = re.exec(CSS)) !== null) {
    for (const v of m[2].matchAll(new RegExp(`(${prefix}[a-z0-9-]+)\\s*:`, 'g'))) names.add(v[1])
  }
  return names
}

/** COLORS のキー（SCREAMING_SNAKE）→ CSS 変数名 */
function toVarName(prefix: string, key: string): string {
  return `${prefix}${key.toLowerCase().replace(/_/g, '-')}`
}

const CHARTS = [
  { name: 'ガント', prefix: '--gantt-', colors: GANTT_CONFIG.COLORS as Record<string, string>, dir: 'src/components/gantt' },
  { name: 'バーンダウン', prefix: '--burndown-', colors: BURNDOWN_CONFIG.COLORS as Record<string, string>, dir: 'src/components/burndown' },
]

describe.each(CHARTS)('$name の色トークン', ({ prefix, colors, dir }) => {
  it('COLORS は全て var() 参照で、キー名と変数名が対応する', () => {
    for (const [key, value] of Object.entries(colors)) {
      expect(value, `${key} が hex 直書きのまま`).toMatch(new RegExp(`^var\\(${prefix}[a-z0-9-]+\\)$`))
      expect(value).toBe(`var(${toVarName(prefix, key)})`)
    }
  })

  it('使われている変数は :root と .dark の両方で定義されている', () => {
    const light = varsIn(':root', prefix)
    const dark = varsIn('\\.dark', prefix)
    const used = new Set(Object.keys(colors).map((k) => toVarName(prefix, k)))
    // globals.css 自身が使っている分（スクロールバーなど）も漏れの対象
    for (const m of CSS.matchAll(new RegExp(`var\\((${prefix}[a-z0-9-]+)\\)`, 'g'))) used.add(m[1])
    for (const name of used) {
      expect(light.has(name), `${name} が :root に無い`).toBe(true)
      expect(dark.has(name), `${name} が .dark に無い（ダークで色が残る）`).toBe(true)
    }
  })

  it('コンポーネントに色の hex 直書きが無い', () => {
    const offenders: string[] = []
    for (const file of readdirSync(join(ROOT, dir))) {
      if (!file.endsWith('.tsx') || file.includes('.test.')) continue
      const src = readFileSync(join(ROOT, dir, file), 'utf8')
      src.split('\n').forEach((line, i) => {
        if (/#[0-9A-Fa-f]{3,8}\b/.test(line)) offenders.push(`${file}:${i + 1} ${line.trim()}`)
      })
    }
    expect(offenders).toEqual([])
  })
})

/**
 * 文書エディタ（Wiki・議事録）のリンク色も、片方のテーマだけ定義すると
 * もう片方で沈む。globals.css の中で使っている --doc-* を同じ観点で見る。
 */
describe('文書エディタの色トークン', () => {
  it('使われている --doc-* は :root と .dark の両方で定義されている', () => {
    const light = varsIn(':root', '--doc-')
    const dark = varsIn('\\.dark', '--doc-')
    const used = new Set<string>()
    for (const m of CSS.matchAll(/var\((--doc-[a-z0-9-]+)\)/g)) used.add(m[1])
    expect(used.size, '--doc-* が1つも使われていない（セレクタ側の変更漏れ）').toBeGreaterThan(0)
    for (const name of used) {
      expect(light.has(name), `${name} が :root に無い`).toBe(true)
      expect(dark.has(name), `${name} が .dark に無い（ダークで色が残る）`).toBe(true)
    }
  })
})
