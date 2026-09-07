import { describe, it, expect } from 'vitest'
import { parseDelimited, detectDelimiter } from '@/lib/table/parseDelimited'

/**
 * CSV/TSV → 表データ(見出し＋行)の純関数。
 * ファイル→表ビュー(v0.1 読み取り専用)と、将来の表編集(保存時の逆変換)の共通土台。
 */
describe('detectDelimiter', () => {
  it('カンマ区切りを検出する', () => {
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',')
  })
  it('タブ区切りを検出する', () => {
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t')
  })
  it('引用符の中の区切り文字は数えない', () => {
    // 1行目: 引用符内にタブが3つ・カンマが1つ → カンマ
    expect(detectDelimiter('"x\t\t\ty",b\n1,2')).toBe(',')
  })
  it('区切りが無ければカンマにする', () => {
    expect(detectDelimiter('hello')).toBe(',')
  })
})

describe('parseDelimited', () => {
  it('1行目を見出し、以降を行として返す', () => {
    const t = parseDelimited('会社名,都道府県\nA社,広島県\nB社,福岡県\n')
    expect(t.columns).toEqual(['会社名', '都道府県'])
    expect(t.rows).toEqual([['A社', '広島県'], ['B社', '福岡県']])
  })

  it('引用符で囲んだセルの中のカンマ・改行・二重引用符を正しく扱う', () => {
    const t = parseDelimited('a,b\n"x, y","line1\nline2"\n"say ""hi""",z')
    expect(t.rows).toEqual([['x, y', 'line1\nline2'], ['say "hi"', 'z']])
  })

  it('CRLF と BOM を取り除く', () => {
    const t = parseDelimited('﻿a,b\r\n1,2\r\n')
    expect(t.columns).toEqual(['a', 'b'])
    expect(t.rows).toEqual([['1', '2']])
  })

  it('末尾の空行と、全セル空の行は取り込まない', () => {
    const t = parseDelimited('a,b\n1,2\n,\n\n')
    expect(t.rows).toEqual([['1', '2']])
  })

  it('短い行は空セルで埋め、長い行があれば見出しを「列N」で補う', () => {
    const t = parseDelimited('a,b\n1\n1,2,3')
    expect(t.columns).toEqual(['a', 'b', '列3'])
    expect(t.rows).toEqual([['1', '', ''], ['1', '2', '3']])
  })

  it('空の見出しセルは「列N」にする', () => {
    const t = parseDelimited(',大項目,タスク\n1,設計,整理')
    expect(t.columns).toEqual(['列1', '大項目', 'タスク'])
  })

  it('区切り文字を自動判定する(TSV)', () => {
    const t = parseDelimited('a\tb\n1\t2')
    expect(t.columns).toEqual(['a', 'b'])
    expect(t.rows).toEqual([['1', '2']])
  })

  it('空文字は空の表を返す', () => {
    expect(parseDelimited('')).toEqual({ columns: [], rows: [] })
  })
})

describe('parseDelimited 大きな表', () => {
  it('20万行でも落ちずに読める(引数展開の上限に当たらない)', () => {
    const lines = ['a,b,c']
    for (let i = 0; i < 200_000; i++) lines.push(`${i},x,y`)
    const t = parseDelimited(lines.join('\n'))
    expect(t.columns).toEqual(['a', 'b', 'c'])
    expect(t.rows).toHaveLength(200_000)
  })
})
