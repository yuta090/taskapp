import { describe, it, expect } from 'vitest'
import {
  resolveDefaultReviewerIds,
  toggleDefaultReviewer,
} from '@/lib/review/defaultReviewers'

describe('resolveDefaultReviewerIds — 既定の承認者を「いま依頼できる人」に絞る', () => {
  it('選択できるメンバーに残っている人だけを返す', () => {
    expect(resolveDefaultReviewerIds(['a', 'b'], ['a', 'c'])).toEqual(['a'])
  })

  it('スペースを抜けた人は落とす（設定に残っていても依頼先にしない）', () => {
    expect(resolveDefaultReviewerIds(['gone'], ['a', 'b'])).toEqual([])
  })

  it('自分は選択肢に含まれないので、自分が既定でも選ばれない', () => {
    // 呼び出し側は「自分を除いた社内メンバー」を渡す
    expect(resolveDefaultReviewerIds(['me', 'a'], ['a'])).toEqual(['a'])
  })

  it('設定順を保つ', () => {
    expect(resolveDefaultReviewerIds(['b', 'a'], ['a', 'b'])).toEqual(['b', 'a'])
  })

  it('重複は1つにまとめる', () => {
    expect(resolveDefaultReviewerIds(['a', 'a'], ['a'])).toEqual(['a'])
  })

  it('未設定(null / undefined / 空)は空配列', () => {
    expect(resolveDefaultReviewerIds(null, ['a'])).toEqual([])
    expect(resolveDefaultReviewerIds(undefined, ['a'])).toEqual([])
    expect(resolveDefaultReviewerIds([], ['a'])).toEqual([])
  })
})

describe('toggleDefaultReviewer — チェックの付け外し', () => {
  it('チェックを付けると末尾に足される', () => {
    expect(toggleDefaultReviewer(['a'], 'b', true)).toEqual(['a', 'b'])
  })

  it('すでに既定の人を付け直しても増えない', () => {
    expect(toggleDefaultReviewer(['a', 'b'], 'b', true)).toEqual(['a', 'b'])
  })

  it('チェックを外すとその人だけ消える', () => {
    expect(toggleDefaultReviewer(['a', 'b', 'c'], 'b', false)).toEqual(['a', 'c'])
  })

  it('未設定から付けられる', () => {
    expect(toggleDefaultReviewer(null, 'a', true)).toEqual(['a'])
  })

  it('元の配列を書き換えない', () => {
    const before = ['a']
    toggleDefaultReviewer(before, 'b', true)
    expect(before).toEqual(['a'])
  })
})
