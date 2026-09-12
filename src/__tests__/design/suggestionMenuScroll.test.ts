import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Wiki の「/」メニューが画面の下で見切れるのを防ぐ回帰テスト。
 *
 * BlockNote は入る高さを floating-ui の size で `max-height` として渡してくるが、
 * Mantine 側の一覧（`.bn-suggestion-menu`）は `max-height: 100%` だけで overflow の指定が無い。
 * そのため画面の下の方で「/」を押すと、はみ出した項目がそのまま枠の外に出て、
 * アプリの外枠（AppShell の `h-[100dvh] overflow-hidden`）に切られて選べなくなる。
 * 一覧の中でスクロールさせて、常に全部の項目に手が届くようにする。
 *
 * 絵文字などの格子状のメニュー（`.bn-grid-suggestion-menu`）も同じ作りなので合わせて見る。
 */
const CSS_PATH = join(process.cwd(), 'src/app/globals.css')

/** セレクタのブロックの中身を取り出す（見つからなければ null） */
function ruleBody(css: string, selector: string): string | null {
  const start = css.indexOf(selector)
  if (start === -1) return null
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  if (open === -1 || close === -1) return null
  return css.slice(open + 1, close)
}

describe('BlockNote の「/」メニューは中でスクロールする', () => {
  const css = readFileSync(CSS_PATH, 'utf8')

  it.each([
    ['.bn-suggestion-menu', '「/」メニュー'],
    ['.bn-grid-suggestion-menu', '絵文字などの格子メニュー'],
  ])('%s に縦スクロールを付けている（%s）', (selector) => {
    const body = ruleBody(css, selector)
    expect(body).not.toBeNull()
    expect(body).toMatch(/overflow-y:\s*auto/)
  })
})
