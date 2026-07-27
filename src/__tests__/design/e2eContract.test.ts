import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * E2E が実装に対して置いている「前提」が、まだ実装側に存在するかを検査する番人。
 *
 * **なぜ必要か**: E2E(Playwright)は実行コストが高くCIに載せていない。そのため
 * 実装の側で名前やクラスが変わっても、E2E が壊れたことに誰も気付けない。
 * 実際に #428（ダークテーマ）で `bg-white` → `bg-surface` に変わった際、E2E の判定は
 * `bg-white shadow-sm` のまま取り残され、次に誰かが E2E を回すまで放置されていた。
 *
 * この検査はブラウザを起動しない。ソースを読むだけなので**ほぼ無料**で、
 * 既存のユニットテストCIの中で毎PR走る。E2E本体の代わりにはならないが、
 * 「E2Eが確実に落ちる状態のまま気付かない」という一番痛い抜けを塞ぐ。
 *
 * 検査するのは、実装の変更で静かにズレる3種類:
 *   1. data-testid       … 要素の目印
 *   2. toHaveClass の文字列 … 見た目クラスへの依存
 *   3. getByRole の name  … ボタン・リンク等の表示名
 */

const ROOT = path.resolve(__dirname, '../../..')
const E2E_DIR = path.join(ROOT, 'tests', 'e2e')
const SRC_DIR = path.join(ROOT, 'src')

function readAll(dir: string, exts: string[]): string {
  let out = ''
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    // exFAT 上で macOS が作る `._*`（リソースフォーク）はソースではない
    if (entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out += readAll(full, exts)
    else if (exts.some((e) => entry.name.endsWith(e))) out += fs.readFileSync(full, 'utf8') + '\n'
  }
  return out
}

const e2eSource = readAll(E2E_DIR, ['.ts'])
const appSource = readAll(SRC_DIR, ['.tsx', '.ts'])

function uniqueMatches(re: RegExp, source: string): string[] {
  return Array.from(new Set(Array.from(source.matchAll(re), (m) => m[1])))
}

describe('E2E が置いている前提が実装側に残っているか', () => {
  it('getByTestId で指す目印が実装に存在する', () => {
    const ids = uniqueMatches(/getByTestId\(['"]([^'"]+)['"]\)/g, e2eSource)
    expect(ids.length, 'E2Eから testid を1つも拾えていない（検査が空振りしている）').toBeGreaterThan(0)

    // 実装側は 2 通りの書き方をする:
    //   静的  data-testid="tasks-filter-all"
    //   動的  data-testid={`meeting-inspector-tab-${tab.id}`}  ← 前半だけ照合する
    const staticIds = new Set(uniqueMatches(/data-testid="([^"]+)"/g, appSource))
    const dynamicPrefixes = uniqueMatches(/data-testid=\{`([^`$]*)\$\{/g, appSource)

    const missing = ids.filter(
      (id) => !staticIds.has(id) && !dynamicPrefixes.some((p) => p !== '' && id.startsWith(p)),
    )
    expect(missing, `実装に無い testid（E2Eが必ず落ちる）:\n${missing.join('\n')}`).toEqual([])
  })

  it('toHaveClass が期待するクラス文字列が実装に存在する', () => {
    // 正規表現のメタ文字を含むものは静的に照合できないので対象外にする
    const raw = uniqueMatches(/toHaveClass\(\/([^/]+)\/\)/g, e2eSource)
    const literals = raw.filter((s) => !/[\\^$*+?()[\]{}|]/.test(s))

    const missing = literals.filter((cls) => !appSource.includes(cls))
    expect(
      missing,
      `実装に無いクラス指定（E2Eが必ず落ちる）:\n${missing.join('\n')}`,
    ).toEqual([])
  })

  it('getByRole の name（ボタン・リンクの表示名）が実装に存在する', () => {
    const names = uniqueMatches(/getByRole\(['"][a-z]+['"],\s*\{[^}]*name:\s*['"]([^'"]+)['"]/g, e2eSource)
    expect(names.length, 'E2Eから role の name を1つも拾えていない').toBeGreaterThan(0)

    const missing = names.filter((name) => !appSource.includes(name))
    expect(missing, `実装に無い表示名（E2Eが必ず落ちる）:\n${missing.join('\n')}`).toEqual([])
  })
})
