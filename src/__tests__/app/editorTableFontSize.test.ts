import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Wiki と議事録の表は、本文より一段小さい文字にする（本文と同じ16pxだと列が広がりすぎる）。
// 見た目の指定なので、globals.css に両方のエディタぶんの指定があることだけを確かめる
describe('文書エディタの表の文字の大きさ', () => {
  const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')

  it.each(['.wiki-editor', '.minutes-editor'])('%s の表のセルに文字の大きさの指定がある', (scope) => {
    const re = new RegExp(`${scope.replace('.', '\\.')} \\.bn-block-content\\[data-content-type="table"\\] (th|td)[^{]*\\{[^}]*font-size:\\s*13px`)
    expect(css).toMatch(re)
  })
})
