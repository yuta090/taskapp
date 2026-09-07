import { describe, it, expect } from 'vitest'
import { decodeTextBuffer } from '@/lib/table/decodeText'

/**
 * 日本のCSVは Shift_JIS のことが多い。UTF-8 として壊れていたら Shift_JIS で読み直す。
 */
describe('decodeTextBuffer', () => {
  it('UTF-8 をそのまま読む(BOM も除く)', () => {
    const bytes = new TextEncoder().encode('﻿会社名,都道府県')
    const r = decodeTextBuffer(bytes.buffer)
    expect(r.encoding).toBe('utf-8')
    expect(r.text).toBe('会社名,都道府県')
  })

  it('UTF-8 として壊れていれば Shift_JIS で読む', () => {
    // "広島" の Shift_JIS: 8D 4C 93 87
    const sjis = new Uint8Array([0x8d, 0x4c, 0x93, 0x87, 0x2c, 0x41])
    const r = decodeTextBuffer(sjis.buffer)
    expect(r.encoding).toBe('shift_jis')
    expect(r.text).toBe('広島,A')
  })

  it('空のバッファは空文字', () => {
    expect(decodeTextBuffer(new ArrayBuffer(0))).toEqual({ text: '', encoding: 'utf-8' })
  })
})
