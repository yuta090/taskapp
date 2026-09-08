import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import manifest from '@/app/manifest'

describe('PWAマニフェスト', () => {
  it('iPhoneでプッシュを受け取れる条件(standalone表示)を満たす', () => {
    // iOS は standalone のPWAにしか Web Push を配信しない。ここが変わると
    // 「ホーム画面に追加しても通知が来ない」に静かに戻る
    expect(manifest().display).toBe('standalone')
    expect(manifest().scope).toBe('/')
  })

  it('必要なサイズのアイコンを揃えている', () => {
    const sizes = (manifest().icons ?? []).map((i) => `${i.sizes}:${i.purpose}`)
    expect(sizes).toContain('192x192:any')
    expect(sizes).toContain('512x512:any')
    expect(sizes).toContain('192x192:maskable')
    expect(sizes).toContain('512x512:maskable')
  })

  it('参照しているアイコンが実在する', () => {
    for (const icon of manifest().icons ?? []) {
      expect(existsSync(`public${icon.src}`), icon.src as string).toBe(true)
    }
  })
})
