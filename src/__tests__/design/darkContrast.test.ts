import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * ダークテーマのコントラスト規約を機械的に守らせる番人。
 *
 * ダークは中央トークンを反転させる方式なので、グレーは明暗の役割が入れ替わる
 * （ライト: gray-900=#111827 が濃 / ダーク: gray-900=#F2F4F7 が明）。
 * 一方 `text-white` は **白のまま反転しない**。
 *
 * このため「濃いグレー地 × 白文字」で組むと、ダークでは
 * 「明るいグレー地 × 白文字」になり、文字がほぼ見えなくなる。
 * 反転が要る箇所は gray の対（例: `bg-gray-900` × `text-gray-100`）で組むこと。
 *
 * `text-white` 自体は禁止ではない — amber-500 等の有彩色の上では両テーマで正しい。
 * ここで弾くのは「反転するグレーを地にした場合」だけ。
 *
 * 対象外:
 *  - portal / vendor-portal … クライアント向けでライト固定（isDarkAllowedPath）
 *  - マーケ/LP/task6/shindan … 同じくライト固定
 */

// 同じ className 文字列の中に「gray-600〜900 の背景」と「白文字」が同居しているか
const VIOLATION =
  /bg-gray-(?:600|700|800|900)[^"'`]*text-white|text-white[^"'`]*bg-gray-(?:600|700|800|900)/

/** ライト固定のためこの規約の対象外にするパス */
const LIGHT_ONLY = [
  path.join('src', 'app', 'portal'),
  path.join('src', 'app', 'vendor-portal'),
  path.join('src', 'components', 'portal'),
  path.join('src', 'app', 'task6'),
  path.join('src', 'app', 'shindan'),
]

function collectTsx(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.name.startsWith('.') || entry.name === '__tests__') continue
    if (entry.isDirectory()) collectTsx(full, acc)
    else if (entry.name.endsWith('.tsx')) acc.push(full)
  }
  return acc
}

describe('ダークテーマのコントラスト規約', () => {
  it('反転するグレー地に text-white を重ねない（ダークで文字が消えるため）', () => {
    const root = path.resolve(__dirname, '../../..')
    const files = collectTsx(path.join(root, 'src'))

    const violations: string[] = []
    for (const file of files) {
      const rel = path.relative(root, file)
      if (LIGHT_ONLY.some((p) => rel.startsWith(p))) continue

      const lines = fs.readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (VIOLATION.test(line)) violations.push(`${rel}:${i + 1}`)
      })
    }

    expect(violations, `gray地×白文字（ダークで読めなくなる）:\n${violations.join('\n')}`).toEqual(
      [],
    )
  })
})
