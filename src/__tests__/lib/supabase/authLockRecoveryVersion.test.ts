import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// 実際に起きたこと（2026-09-15）: 画面を開いたまま使っていると「保存できませんでした」
// 「読み込みに失敗しました」「AbortError: signal is aborted without reason」が出続け、
// 再読み込みするまで直らなかった。
//
// 原因は Supabase のログイン部品（@supabase/auth-js）がブラウザの鍵（Web Locks）を
// 置き去りにする不具合（supabase/supabase-js #2111）。鍵が返されないと、以後の読み書きは
// すべて鍵待ちで打ち切られる。2.98.0 で「待ち時間切れなら鍵を奪って回復する」(#2106)・
// 「待ち時間 10秒→5秒」(#2125)、2.99.3 で「奪い合いの連鎖を防ぐ」(#2178) が入った。
// ここを下回る版に戻すと、同じ症状が再発する。
// 2.100.0 以降はリアルタイム通信の中身の入れ替えと検索条件の型の厳格化が入るため、
// 版上げの幅を抑えて 2.99.3 に止めている（鍵の処理は 2.100.0 と同一）。
const MIN_AUTH_JS = [2, 99, 3] as const

function parseVersion(version: string): [number, number, number] {
  const [major, minor, patch] = version.split('-')[0].split('.').map((n) => Number(n))
  return [major, minor, patch]
}

function isAtLeast(version: string, min: readonly [number, number, number]): boolean {
  const v = parseVersion(version)
  for (let i = 0; i < 3; i++) {
    if (v[i] !== min[i]) return v[i] > min[i]
  }
  return true
}

function readVersion(packageJsonPath: string): string {
  return (JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version: string }).version
}

// supabase-js が実際に読み込む auth-js（入れ子にあればそちらが優先される）
function resolvedAuthJsVersion(): string {
  const root = process.cwd()
  const nested = join(root, 'node_modules/@supabase/supabase-js/node_modules/@supabase/auth-js/package.json')
  const hoisted = join(root, 'node_modules/@supabase/auth-js/package.json')
  return readVersion(existsSync(nested) ? nested : hoisted)
}

describe('Supabase のログイン部品の版', () => {
  it('置き去りの鍵から自動で回復できる版（auth-js 2.99.3 以上）を使っている', () => {
    const version = resolvedAuthJsVersion()
    expect(isAtLeast(version, MIN_AUTH_JS), `auth-js@${version} は鍵の回復処理より古い`).toBe(true)
  })

  it('版の比較は文字でなく数値で行う（2.100.0 は 2.99.3 より新しい）', () => {
    expect(isAtLeast('2.94.1', MIN_AUTH_JS)).toBe(false)
    expect(isAtLeast('2.99.2', MIN_AUTH_JS)).toBe(false)
    expect(isAtLeast('2.99.3', MIN_AUTH_JS)).toBe(true)
    expect(isAtLeast('2.100.0', MIN_AUTH_JS)).toBe(true)
    expect(isAtLeast('3.0.0-rc.1', MIN_AUTH_JS)).toBe(true)
  })
})
