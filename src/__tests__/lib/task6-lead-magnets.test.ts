import { describe, it, expect } from 'vitest'
import { LEAD_MAGNETS, getLeadMagnet } from '@/lib/task6/leadMagnets'

/**
 * TASK6 テンプレ配布カタログ（コード定義）
 * key は DB(check制約 ^[a-z0-9-]{1,64}$)・URL(/task6/dl/[key])の両方に使うため形式を固定する
 */

describe('LEAD_MAGNETS', () => {
  it('少なくとも1つのテンプレが登録されている', () => {
    expect(Object.keys(LEAD_MAGNETS).length).toBeGreaterThan(0)
  })

  it('全keyがDBのcheck制約と同じ形式(^[a-z0-9-]{1,64}$)を満たす', () => {
    for (const key of Object.keys(LEAD_MAGNETS)) {
      expect(key).toMatch(/^[a-z0-9-]{1,64}$/)
    }
  })

  it('各エントリのkeyフィールドがマップのキーと一致し、必須フィールドが埋まっている', () => {
    for (const [key, magnet] of Object.entries(LEAD_MAGNETS)) {
      expect(magnet.key).toBe(key)
      expect(magnet.title.length).toBeGreaterThan(0)
      expect(magnet.description.length).toBeGreaterThan(0)
      expect(magnet.storagePath.length).toBeGreaterThan(0)
      expect(magnet.fileName.length).toBeGreaterThan(0)
      expect(magnet.bullets.length).toBeGreaterThan(0)
    }
  })

  it('getLeadMagnetは既知のkeyでエントリを返し、未知のkeyでnullを返す', () => {
    const firstKey = Object.keys(LEAD_MAGNETS)[0]
    expect(getLeadMagnet(firstKey)?.key).toBe(firstKey)
    expect(getLeadMagnet('no-such-template')).toBeNull()
  })
})
