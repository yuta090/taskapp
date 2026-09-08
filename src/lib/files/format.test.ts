import { describe, it, expect } from 'vitest'
import { formatFileSize, formatFileDate } from './format'

describe('formatFileSize', () => {
  it('returns "0 B" for zero bytes', () => {
    expect(formatFileSize(0)).toBe('0 B')
  })

  it('formats bytes below 1KB as B', () => {
    expect(formatFileSize(512)).toBe('512 B')
  })

  it('formats kilobytes with one decimal', () => {
    expect(formatFileSize(1536)).toBe('1.5 KB')
  })

  it('formats megabytes', () => {
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5 MB')
  })

  it('formats gigabytes', () => {
    expect(formatFileSize(2 * 1024 * 1024 * 1024)).toBe('2 GB')
  })
})

describe('formatFileDate', () => {
  it('「7月1日」の形にする', () => {
    expect(formatFileDate('2026-07-01T00:00:00')).toBe('7月1日')
  })

  it('月をまたいでも同じ形', () => {
    expect(formatFileDate('2026-12-25T10:30:00')).toBe('12月25日')
  })

  it('一覧の全行で使うので、書式オブジェクトは毎回作り直さない', () => {
    // 行ごとに toLocaleDateString(オプション付き) を呼ぶと 1000 行で 40ms 超になる。
    // 同じ Intl.DateTimeFormat を使い回していることを、呼び出し回数ではなく
    // 「10000 回呼んでも十分速い」ことで担保する
    const start = performance.now()
    for (let i = 0; i < 10000; i++) formatFileDate('2026-07-01T00:00:00')
    expect(performance.now() - start).toBeLessThan(300)
  })
})
