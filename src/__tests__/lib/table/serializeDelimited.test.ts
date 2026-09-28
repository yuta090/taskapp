import { describe, it, expect } from 'vitest'
import { serializeDelimited, toCsvBytes, UTF8_BOM } from '@/lib/table/serializeDelimited'
import { parseDelimited, detectDelimiter, type TableData } from '@/lib/table/parseDelimited'
import { decodeTextBuffer } from '@/lib/table/decodeText'

const simple: TableData = {
  columns: ['会社名', '都道府県', '商談件数'],
  rows: [
    ['ＪＦＥスチール株式会社', '広島県', '1'],
    ['アースサポート株式会社', '島根県', '0'],
  ],
}

describe('serializeDelimited', () => {
  it('見出し＋行を CRLF 区切りで書き出す', () => {
    expect(serializeDelimited(simple)).toBe(
      '会社名,都道府県,商談件数\r\n' +
        'ＪＦＥスチール株式会社,広島県,1\r\n' +
        'アースサポート株式会社,島根県,0'
    )
  })

  it('区切り・引用符・改行を含むセルは引用符で囲む(" は "" にする)', () => {
    const data: TableData = {
      columns: ['メモ'],
      rows: [['a,b'], ['彼は"すごい"と言った'], ['1行目\n2行目'], ['末尾\r改行']],
    }
    const csv = serializeDelimited(data)
    expect(csv).toContain('"a,b"')
    expect(csv).toContain('"彼は""すごい""と言った"')
    expect(csv).toContain('"1行目\n2行目"')
    expect(csv).toContain('"末尾\r改行"')
  })

  it('囲む必要のないセルは囲まない', () => {
    expect(serializeDelimited({ columns: ['a'], rows: [['ふつうの値']] })).toBe('a\r\nふつうの値')
  })

  it('タブ区切り(.tsv)では、タブを含むセルだけ囲む', () => {
    const data: TableData = { columns: ['メモ'], rows: [['a,b'], ['a\tb']] }
    const tsv = serializeDelimited(data, '\t')
    expect(tsv).toContain('a,b')
    expect(tsv).not.toContain('"a,b"')
    expect(tsv).toContain('"a\tb"')
  })

  it('列より短い行は空セルで埋め、長い行は列の数で切る', () => {
    const data: TableData = { columns: ['a', 'b', 'c'], rows: [['1'], ['1', '2', '3', '4']] }
    expect(serializeDelimited(data)).toBe('a,b,c\r\n1,,\r\n1,2,3')
  })

  it('列が無いときは空文字を返す', () => {
    expect(serializeDelimited({ columns: [], rows: [] })).toBe('')
  })

  it('書き出して読み直すと元の表に戻る(往復)', () => {
    const data: TableData = {
      columns: ['会社名', 'メモ'],
      rows: [
        ['A社', 'カンマ, と "引用符"'],
        ['B社', '改行\nあり'],
        ['C社', ''],
      ],
    }
    expect(parseDelimited(serializeDelimited(data))).toEqual(data)
  })

  it('セミコロン区切りで書き出しても、読み直しで区切りを取り違えない', () => {
    const data: TableData = { columns: ['a', 'b'], rows: [['1', '2']] }
    const text = serializeDelimited(data, ';')
    expect(detectDelimiter(text)).toBe(';')
    expect(parseDelimited(text)).toEqual(data)
  })
})

describe('toCsvBytes', () => {
  it('Excel が日本語を化けさせないよう UTF-8 の BOM を付ける', () => {
    const bytes = toCsvBytes(simple)
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf])
  })

  it('書き出したバイト列は、表ビューと同じ読み方でそのまま元の表に戻る', () => {
    const bytes = toCsvBytes(simple)
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    const { text, encoding } = decodeTextBuffer(buffer)
    expect(encoding).toBe('utf-8')
    expect(parseDelimited(text)).toEqual(simple)
  })

  it('タブ区切りを渡すと、そのまま TSV として書き出す', () => {
    const bytes = toCsvBytes({ columns: ['a', 'b'], rows: [['1', '2']] }, '\t')
    // TextDecoder は既定で BOM を落として読むため、BOM ごと見たいときは ignoreBOM を立てる
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)
    expect(text).toBe(`${UTF8_BOM}a\tb\r\n1\t2`)
  })
})
