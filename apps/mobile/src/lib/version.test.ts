import { describe, expect, it } from 'vitest'
import { compareVersions, isVersionSupported, parseMinSupportedVersion } from './version'

describe('compareVersions', () => {
  it('数字として比べる（文字列比較だと 1.10 < 1.9 になってしまう）', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0)
    expect(compareVersions('1.9.0', '1.10.0')).toBeLessThan(0)
  })
  it('同じ版は 0', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
  })
  it('足りない桁は 0 とみなす', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0)
    expect(compareVersions('2', '1.99.99')).toBeGreaterThan(0)
  })
})

describe('isVersionSupported', () => {
  it('最低の版と同じか新しければ使える', () => {
    expect(isVersionSupported('1.0.0', '1.0.0')).toBe(true)
    expect(isVersionSupported('1.2.0', '1.0.5')).toBe(true)
  })
  it('最低の版より古ければ使えない', () => {
    expect(isVersionSupported('1.0.0', '1.0.1')).toBe(false)
  })
  it('最低の版が分からない（通信失敗など）ときは止めない', () => {
    expect(isVersionSupported('1.0.0', null)).toBe(true)
  })
  it('自分の版が読めないときも止めない', () => {
    expect(isVersionSupported(null, '9.0.0')).toBe(true)
  })
})

describe('parseMinSupportedVersion', () => {
  it('サーバーの返す形から最低の版を取り出す', () => {
    expect(parseMinSupportedVersion({ minSupportedVersion: '1.2.0' })).toBe('1.2.0')
  })
  it('形が違う・版の書式でないものは null（止めない側に倒す）', () => {
    expect(parseMinSupportedVersion(null)).toBeNull()
    expect(parseMinSupportedVersion({})).toBeNull()
    expect(parseMinSupportedVersion({ minSupportedVersion: 3 })).toBeNull()
    expect(parseMinSupportedVersion({ minSupportedVersion: 'latest' })).toBeNull()
  })
})
