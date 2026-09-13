import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 文書エディタ（Wiki・議事録）の本文中のリンクは、押すと画面が移る。
 * ところが編集中の本文なので、何もしないとカーソルの形は文字入力のまま（I 字）で、
 * 押せることが見た目から分からない。指の形にして「押せる」と伝える。
 */
const CSS = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')

/** セレクタを含むブロックの中身を返す */
function ruleContaining(selector: string): string | null {
  const at = CSS.indexOf(selector)
  if (at === -1) return null
  const open = CSS.indexOf('{', at)
  const close = CSS.indexOf('}', open)
  return open === -1 || close === -1 ? null : CSS.slice(open + 1, close)
}

describe('本文中のリンクは押せると分かる形にする', () => {
  it.each([['.wiki-editor'], ['.minutes-editor']])('%s のリンクに指の形を付けている', (scope) => {
    const body = ruleContaining(`${scope} a[href]`)
    expect(body).not.toBeNull()
    expect(body).toMatch(/cursor:\s*pointer/)
  })
})
