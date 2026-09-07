import { describe, it, expect } from 'vitest'
import { isSafeInternalPath, safeInternalPathOr } from './safeRedirect'

describe('isSafeInternalPath', () => {
  it('内部パスは通す', () => {
    expect(isSafeInternalPath('/inbox')).toBe(true)
    expect(isSafeInternalPath('/a/b?x=1&y=2#h')).toBe(true)
    expect(isSafeInternalPath('/日本語')).toBe(true)
    // %エンコードされた制御文字は文字列としては安全（new URL でも同一 origin に留まる）
    expect(isSafeInternalPath('/%0d%0a')).toBe(true)
  })
  it('外部・プロトコル相対・制御文字・バックスラッシュは弾く', () => {
    for (const bad of ['//evil.example', 'https://evil.example', '/\\evil.example', '/\t/evil.example', '/\n/x', 'inbox', '', '//x', '/\u0000']) {
      expect(isSafeInternalPath(bad), JSON.stringify(bad)).toBe(false)
    }
    expect(isSafeInternalPath(null)).toBe(false)
    expect(isSafeInternalPath(undefined)).toBe(false)
  })
  it('safeInternalPathOr は既定でトップへ', () => {
    expect(safeInternalPathOr('//evil.example')).toBe('/')
    expect(safeInternalPathOr('/inbox')).toBe('/inbox')
  })
})
