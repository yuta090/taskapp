import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * 暗い表示での文書エディタ（Wiki・議事録）の見分けやすさ。ユーザー申告2件の回帰ガード:
 *
 * 1. 「/」メニューの選択中の項目が真っ黒で、どれを選んでいるか分からない
 *    → メニューは本文の外（body 直下のポータル）に出るため、`.dark .minutes-editor .bn-container`
 *      のように面の子孫に限った上書きが届かず、BlockNote 既定のダーク
 *      （selected 背景 #0f0f0f＝面より暗い）がそのまま出ていた。
 * 2. 会議メモの帯の背景が面と同化して分かりづらい
 *    → ダークの blue-50(#101F35) が面(#191E27)と近すぎた。
 */

const SRC = path.resolve(__dirname, '../..')
const read = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8')

/** globals.css から、BlockNote の色を差し替えているダークの規則を取り出す */
function darkBlockNoteRule(css: string): { selector: string; body: string } {
  const match = css.match(/([^}]*--bn-colors-selected-background[^}]*)\}/)
  if (!match) throw new Error('BlockNote の色を差し替える規則が見つからない')
  const block = match[1]
  const braceAt = block.lastIndexOf('{')
  return { selector: block.slice(0, braceAt).trim(), body: block.slice(braceAt + 1) }
}

describe('暗い表示: 「/」メニューの選択が見分けられる', () => {
  const css = read('app/globals.css')
  const { selector, body } = darkBlockNoteRule(css)

  it('上書きは本文の外（ポータル）に出るメニューにも届く形にする', () => {
    // `.dark .minutes-editor .bn-container` のように面の子孫へ限定しない。
    // BlockNote が色の持ち主に付ける [data-color-scheme] を目印にする
    expect(selector).toContain('[data-color-scheme="dark"]')
    expect(selector).not.toMatch(/\.(minutes|wiki)-editor\s+\.bn-container/)
  })

  it('選んでいる項目の背景は、メニューの面より明るい階調にする', () => {
    // 面は --color-surface(#191E27)。gray-100(#1B2028) はほぼ同じ暗さで沈むため使わない
    expect(body).toMatch(/--bn-colors-menu-background:\s*var\(--color-surface\)/)
    expect(body).toMatch(/--bn-colors-hovered-background:\s*var\(--color-gray-200\)/)
    expect(body).toMatch(/--bn-colors-selected-background:\s*var\(--color-gray-300\)/)
  })

  it('選んでいる項目の文字は、いちばん明るい階調にする', () => {
    expect(body).toMatch(/--bn-colors-hovered-text:\s*var\(--color-gray-900\)/)
    expect(body).toMatch(/--bn-colors-selected-text:\s*var\(--color-gray-900\)/)
  })
})

describe('暗い表示: 会議メモの帯が本文と見分けられる', () => {
  it('帯の背景は、面と同化する blue-50 ではなく1段明るい blue-100 にする', () => {
    const src = read('components/meeting/minutesBlocks.tsx')
    expect(src).toContain('bg-blue-100')
    expect(src).not.toContain('bg-blue-50')
  })

  it('帯の左線は残す（背景だけに頼らず、はみ出しても位置が分かるように）', () => {
    const src = read('components/meeting/minutesBlocks.tsx')
    expect(src).toMatch(/border-l-4\s+border-blue-\d{3}/)
  })
})
