import { describe, it, expect } from 'vitest'
import { parseCsv } from './csv.js'

describe('parseCsv', () => {
  it('カンマ区切りの素朴な行を配列にする', () => {
    expect(parseCsv('a,b,c\n1,2,3\n')).toEqual([
      { line: 1, cells: ['a', 'b', 'c'] },
      { line: 2, cells: ['1', '2', '3'] },
    ])
  })

  it('ダブルクォート内のカンマ・改行・"" エスケープを扱う', () => {
    const text = 'title,desc\n"a, b","line1\nline2 ""quoted"""\nnext,x\n'
    expect(parseCsv(text)).toEqual([
      { line: 1, cells: ['title', 'desc'] },
      { line: 2, cells: ['a, b', 'line1\nline2 "quoted"'] },
      { line: 4, cells: ['next', 'x'] },
    ])
  })

  it('BOM と CRLF を吸収し、完全に空の行は捨てる', () => {
    const text = '﻿a,b\r\n\r\n1,2\r\n,\r\n'
    expect(parseCsv(text)).toEqual([
      { line: 1, cells: ['a', 'b'] },
      { line: 3, cells: ['1', '2'] },
    ])
  })

  it('末尾に改行が無くても最後の行を落とさない', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      { line: 1, cells: ['a', 'b'] },
      { line: 2, cells: ['1', '2'] },
    ])
  })

  it('閉じていないクォートはエラーにする', () => {
    expect(() => parseCsv('a,b\n"open,2\n')).toThrow(/2行目/)
  })
})
