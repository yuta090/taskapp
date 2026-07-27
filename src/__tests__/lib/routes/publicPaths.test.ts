import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isPublicPathMatch, publicPaths, STATIC_LP_PATTERN } from '@/lib/routes/publicPaths'

describe('isPublicPathMatch', () => {
  it('公開パスにマッチ', () => {
    expect(isPublicPathMatch('/')).toBe(true)
    expect(isPublicPathMatch('/pricing')).toBe(true)
    expect(isPublicPathMatch('/task6/foo')).toBe(true)
    expect(isPublicPathMatch('/portal/email-action')).toBe(true)
  })
  it('保護パスにはマッチしない', () => {
    expect(isPublicPathMatch('/inbox')).toBe(false)
    expect(isPublicPathMatch('/portal')).toBe(false)
    expect(isPublicPathMatch('/org-1/project/s-1')).toBe(false)
  })
  it('セグメント境界を守る（/privacy が /privacy-policy にマッチしない）', () => {
    expect(isPublicPathMatch('/privacy-policy')).toBe(false)
    expect(isPublicPathMatch('/privacy')).toBe(true)
  })
  it('静的LPパターン', () => {
    expect(STATIC_LP_PATTERN.test('/lp1')).toBe(true)
    expect(STATIC_LP_PATTERN.test('/lp12/')).toBe(true)
    expect(STATIC_LP_PATTERN.test('/lpx')).toBe(false)
  })
})

describe('単一ソース性（proxy が publicPaths モジュールを参照する）', () => {
  it('proxy.ts は publicPaths を再定義せず、共有モジュールから import する', () => {
    const src = readFileSync(resolve(__dirname, '../../../proxy.ts'), 'utf8')
    // 共有モジュールからの import がある
    expect(src).toContain("from '@/lib/routes/publicPaths'")
    // proxy 内でローカルの publicPaths 配列を再定義していない（ドリフト防止）
    expect(src).not.toMatch(/const\s+publicPaths\s*=/)
  })
  it('publicPaths は空でない', () => {
    expect(publicPaths.length).toBeGreaterThan(5)
  })
})

describe('globals.css の @theme は inline でない（ダーク反転の前提）', () => {
  it('@theme inline が復活していない', () => {
    const css = readFileSync(resolve(__dirname, '../../../app/globals.css'), 'utf8')
    // inline だと utility に色が直埋めされ .dark 上書きが効かなくなる
    expect(css).not.toMatch(/@theme\s+inline/)
    // .dark パレットブロックが存在する
    expect(css).toContain('.dark {')
    expect(css).toContain('--color-surface')
  })
})
