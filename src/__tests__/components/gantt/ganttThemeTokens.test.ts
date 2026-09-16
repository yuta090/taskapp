/**
 * ガントチャートの色は全て CSS 変数（--gantt-*）経由で持つ。
 * SVG は Tailwind の utility が効かないため、色は constants.ts が var() 参照を返し、
 * ライト/ダークの実値は globals.css の :root / .dark で切り替える。
 * ここで「hex の直書きが残っていないか」「片方のテーマで定義漏れがないか」を機械的に検査する。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { GANTT_CONFIG } from '@/lib/gantt/constants'

const ROOT = process.cwd()
const CSS = readFileSync(join(ROOT, 'src/app/globals.css'), 'utf8')

/** :root / .dark それぞれで定義されている --gantt-* の名前を集める */
function ganttVarsIn(selector: string): Set<string> {
  const re = new RegExp(`(^|\\n)${selector}\\s*\\{([\\s\\S]*?)\\n\\}`, 'g')
  const names = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = re.exec(CSS)) !== null) {
    for (const v of m[2].matchAll(/(--gantt-[a-z0-9-]+)\s*:/g)) names.add(v[1])
  }
  return names
}

/** GANTT_CONFIG.COLORS のキー（SCREAMING_SNAKE）→ CSS 変数名 */
function toVarName(key: string): string {
  return `--gantt-${key.toLowerCase().replace(/_/g, '-')}`
}

describe('ガントの色トークン', () => {
  it('COLORS は全て var(--gantt-*) 参照で、キー名と変数名が対応する', () => {
    for (const [key, value] of Object.entries(GANTT_CONFIG.COLORS)) {
      expect(value, `${key} が hex 直書きのまま`).toMatch(/^var\(--gantt-[a-z0-9-]+\)$/)
      expect(value).toBe(`var(${toVarName(key)})`)
    }
  })

  it('使われている --gantt-* は :root と .dark の両方で定義されている', () => {
    const light = ganttVarsIn(':root')
    const dark = ganttVarsIn('\\.dark')
    const used = new Set(Object.keys(GANTT_CONFIG.COLORS).map(toVarName))
    // globals.css 自身が使っている分（スクロールバーなど）も漏れの対象
    for (const m of CSS.matchAll(/var\((--gantt-[a-z0-9-]+)\)/g)) used.add(m[1])
    for (const name of used) {
      expect(light.has(name), `${name} が :root に無い`).toBe(true)
      expect(dark.has(name), `${name} が .dark に無い（ダークで色が残る）`).toBe(true)
    }
  })

  it('ガントのコンポーネントに色の hex 直書きが無い', () => {
    const dir = join(ROOT, 'src/components/gantt')
    const offenders: string[] = []
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.tsx') || file.includes('.test.')) continue
      const src = readFileSync(join(dir, file), 'utf8')
      src.split('\n').forEach((line, i) => {
        if (/#[0-9A-Fa-f]{3,8}\b/.test(line)) offenders.push(`${file}:${i + 1} ${line.trim()}`)
      })
    }
    expect(offenders).toEqual([])
  })
})
