import { describe, it, expect } from 'vitest'
import { senderOrgForDigest } from './senderOrgForDigest'

const orgIdByTask = new Map([
  ['t1', 'orgA'],
  ['t2', 'orgA'],
  ['t3', 'orgB'],
  ['t4', null],
])
const names = new Map([['orgA', '事務所A']])

describe('senderOrgForDigest', () => {
  it('1事務所に収まるときだけ名前を返す', () => {
    expect(senderOrgForDigest(['t1', 't2'], orgIdByTask, names)).toBe('事務所A')
  })
  it('2事務所にまたがる／空／不明なら null', () => {
    expect(senderOrgForDigest(['t1', 't3'], orgIdByTask, names)).toBeNull()
    expect(senderOrgForDigest([], orgIdByTask, names)).toBeNull()
    expect(senderOrgForDigest(['t4'], orgIdByTask, names)).toBeNull()
    expect(senderOrgForDigest(['t9'], orgIdByTask, names)).toBeNull()
  })
  it('有料でない（名前が無い）事務所は null', () => {
    expect(senderOrgForDigest(['t3'], orgIdByTask, names)).toBeNull()
  })
})
