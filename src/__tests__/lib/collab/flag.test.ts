import { describe, expect, it } from 'vitest'
import { isCollabEnabledForOrg } from '@/lib/collab/flag'

// 同時編集を開ける組織。最初は自社とデモ組織だけで開ける。

const ORG = '11111111-1111-1111-1111-111111111111'
const OTHER = '22222222-2222-2222-2222-222222222222'

describe('同時編集を開ける組織', () => {
  it('何も設定していなければ、どの組織でも使わない', () => {
    expect(isCollabEnabledForOrg(ORG, '')).toBe(false)
    expect(isCollabEnabledForOrg(ORG, '  ')).toBe(false)
  })

  it('並べた組織だけ使える', () => {
    expect(isCollabEnabledForOrg(ORG, ORG)).toBe(true)
    expect(isCollabEnabledForOrg(OTHER, ORG)).toBe(false)
  })

  it('カンマ区切りで複数並べられる。前後の空白は無視する', () => {
    const raw = ` ${ORG} , ${OTHER} `
    expect(isCollabEnabledForOrg(ORG, raw)).toBe(true)
    expect(isCollabEnabledForOrg(OTHER, raw)).toBe(true)
  })

  it('大文字小文字は区別しない', () => {
    expect(isCollabEnabledForOrg(ORG.toUpperCase(), ORG)).toBe(true)
  })

  it('`*` を入れると全組織で使える', () => {
    expect(isCollabEnabledForOrg(OTHER, '*')).toBe(true)
  })

  it('組織が分からないときは使わない', () => {
    expect(isCollabEnabledForOrg(null, '*')).toBe(false)
    expect(isCollabEnabledForOrg(undefined, '*')).toBe(false)
    expect(isCollabEnabledForOrg('', '*')).toBe(false)
  })
})
