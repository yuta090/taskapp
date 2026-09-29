import { describe, expect, it } from 'vitest'
import { ownerIdsBySide } from './owners'

describe('ownerIdsBySide', () => {
  it('担当者を相手先側・社内側に分ける（rpc_pass_ball は担当者を入れ替えるので、今の担当者をそのまま渡す）', () => {
    expect(
      ownerIdsBySide([
        { side: 'client', user_id: 'c1' },
        { side: 'internal', user_id: 'i1' },
        { side: 'internal', user_id: 'i2' },
      ])
    ).toEqual({ clientOwnerIds: ['c1'], internalOwnerIds: ['i1', 'i2'], hasOtherSides: false })
  })
  it('代理店・ベンダー側の担当者がいたら知らせる（RPC の引数に無いので、渡すと消えてしまう）', () => {
    expect(ownerIdsBySide([{ side: 'vendor', user_id: 'v1' }])).toEqual({
      clientOwnerIds: [],
      internalOwnerIds: [],
      hasOtherSides: true,
    })
  })
  it('同じ人が重なっていても1回だけ', () => {
    expect(
      ownerIdsBySide([
        { side: 'internal', user_id: 'i1' },
        { side: 'internal', user_id: 'i1' },
      ]).internalOwnerIds
    ).toEqual(['i1'])
  })
})
