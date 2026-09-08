import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * ダークテーマの回帰防止。
 *
 * `--color-indigo-50` は .dark で濃紺に反転するが、`--color-indigo-700` は
 * `hover:bg-indigo-700` + 白文字のボタンで「面」としても使うため反転できない。
 * そのため `bg-indigo-50` の上に `text-indigo-600` / `-700` / `-800` / `-900` を置くと、
 * ダークでは濃紺の上に濃い青の文字になって読めない（実測でコントラスト比 約1.9〜2.1:1）。
 * 文字色は `text-indigo-ink`（.dark で明るい藍に反転する）を使う。
 *
 * ライト固定の画面（相手先ポータル・公開ページ）は対象外。
 */
// ライト固定の画面（相手先ポータル・業者ポータル・ログイン/初回設定・マーケLP）は対象外
const LIGHT_ONLY = [
  '/portal/',
  'vendor-portal',
  '(auth)/login',
  '(auth)/onboarding',
  'components/lp/',
]

// indigo-50 の面（.dark で濃紺に反転する）の上に置いてはいけない文字色。
// いずれも .dark で反転しないため、暗い面の上に暗い文字が乗る。
const UNREADABLE_ON_INDIGO_50 = ['text-indigo-600', 'text-indigo-700', 'text-indigo-800', 'text-indigo-900']

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.tsx')) out.push(p)
  }
  return out
}

describe('ダークテーマ: indigo-50 の面の上の文字色', () => {
  it('ダーク対象の画面で indigo-50 の面の上に暗い indigo 文字を置かない', () => {
    const root = join(process.cwd(), 'src')
    const offenders: string[] = []

    for (const file of walk(root)) {
      if (LIGHT_ONLY.some(seg => file.includes(seg))) continue
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (!line.includes('bg-indigo-50')) return
        const bad = UNREADABLE_ON_INDIGO_50.find(cls => line.includes(cls))
        if (bad) offenders.push(`${file.replace(root, 'src')}:${i + 1}  (${bad})`)
      })
    }

    expect(offenders, `text-indigo-ink に置き換えてください:\n${offenders.join('\n')}`).toEqual([])
  })

  it('indigo-ink トークンがライト・ダークの両方で定義されている', () => {
    const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')
    const dark = css.slice(css.indexOf('.dark'))
    expect(css).toContain('--color-indigo-ink:')
    expect(dark).toContain('--color-indigo-ink:')
  })
})
