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

  // `/../` や %エンコードでの正規化後に `//host` へ化けるものは、origin だけの
  // 確認では見抜けない（origin は内部のままでも、パスが `//host` になる）。
  it('正規化後にプロトコル相対になるパスは弾く', () => {
    for (const bad of ['/..//evil.example', '/.//evil.example', '/%2e%2e//evil.example']) {
      expect(isSafeInternalPath(bad), JSON.stringify(bad)).toBe(false)
    }
  })

  it('タブ・大文字スキーム・先頭空白・NUL を含む値は弾く', () => {
    for (const bad of ['/\t/evil.example', 'JAVASCRIPT:alert(1)', ' //evil.example', '/\x00evil']) {
      expect(isSafeInternalPath(bad), JSON.stringify(bad)).toBe(false)
    }
  })
})
