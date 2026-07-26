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
  path.join('src', 'components', 'lp'),
  // メールはテーマトークンが効かない（受信側のクライアントが描画する）
  path.join('src', 'lib', 'email'),
]

/** `bg-white` 直書き。text-white と変数を共有するため単独で暗転できない → bg-surface を使う */
const BG_WHITE = /\bbg-white\b/

/** 色の直書き（arbitrary value）。トークンを経由しないのでテーマ切替が効かない */
const HEX_LITERAL = /\b(?:bg|text|border|ring|from|via|to|fill|stroke)-\[#[0-9A-Fa-f]{3,8}\]/g

/**
 * 例外として直書きを許すブランド色。
 * 他社サービスの色はテーマで反転させてはいけない（Slack の紫は暗くしても Slack の紫）。
 */
const BRAND_HEX = new Set(['#4A154B', '#611f64'])

function collectTsx(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.name.startsWith('.') || entry.name === '__tests__') continue
    if (entry.isDirectory()) collectTsx(full, acc)
    else if (entry.name.endsWith('.tsx')) acc.push(full)
  }
  return acc
}

/** ダーク対象（ログイン後のアプリ画面）の tsx を、行番号つきで走査する */
function scanAppTsx(check: (line: string) => boolean): string[] {
  const root = path.resolve(__dirname, '../../..')
  const violations: string[] = []
  for (const file of collectTsx(path.join(root, 'src'))) {
    const rel = path.relative(root, file)
    if (LIGHT_ONLY.some((p) => rel.startsWith(p))) continue

    fs.readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (check(line)) violations.push(`${rel}:${i + 1}`)
      })
  }
  return violations
}

describe('ダークテーマのコントラスト規約', () => {
  it('反転するグレー地に text-white を重ねない（ダークで文字が消えるため）', () => {
    const violations = scanAppTsx((line) => VIOLATION.test(line))

    expect(violations, `gray地×白文字（ダークで読めなくなる）:\n${violations.join('\n')}`).toEqual(
      [],
    )
  })

  it('面の色は bg-white ではなく bg-surface を使う（bg-white は暗転しない）', () => {
    const violations = scanAppTsx((line) => BG_WHITE.test(line))

    expect(violations, `bg-white 直書き（ダークで白いまま残る）:\n${violations.join('\n')}`).toEqual(
      [],
    )
  })

  it('色は直書きせずトークンを経由する（直書きはテーマ切替が効かない）', () => {
    const violations = scanAppTsx((line) => {
      const hits = line.match(HEX_LITERAL)
      if (!hits) return false
      // ブランド色だけの行は許す
      return hits.some((h) => !BRAND_HEX.has(h.slice(h.indexOf('#'), -1)))
    })

    expect(violations, `色の直書き（テーマ切替が効かない）:\n${violations.join('\n')}`).toEqual([])
  })
})
