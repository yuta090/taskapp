import { describe, it, expect } from 'vitest'
import { describeKeySpaces } from '@/lib/api-keys/keySpaces'

/**
 * アカウントの「APIキー」一覧に出す「使えるプロジェクト」。
 * プロジェクト設定で作ったキーにも持ち主が入り、この一覧に並ぶようになった。
 * そのキーは allowed_space_ids が空なので、そのまま扱うと「全スペース」と誤表示される。
 */
const spaces = [
  { id: 's1', name: 'サンプル商事' },
  { id: 's2', name: '新規事業' },
  { id: 's3', name: '社内' },
]

describe('describeKeySpaces', () => {
  it('プロジェクト設定で作ったキーは、そのプロジェクトだけと出す', () => {
    expect(describeKeySpaces({ scope: 'space', space_id: 's2', allowed_space_ids: null }, spaces)).toBe(
      '新規事業のみ（プロジェクト設定で発行）',
    )
  })

  it('参加していないプロジェクトのキーでも「全スペース」とは出さない', () => {
    expect(describeKeySpaces({ scope: 'space', space_id: 'gone', allowed_space_ids: null }, spaces)).toBe(
      '1つのプロジェクトのみ（プロジェクト設定で発行）',
    )
  })

  it('アカウントで作ったキーで全部選んでいれば「全スペース」', () => {
    expect(describeKeySpaces({ scope: 'user', space_id: 's1', allowed_space_ids: ['s1', 's2', 's3'] }, spaces)).toBe(
      '全スペース',
    )
  })

  it('指定が無ければ「全スペース」', () => {
    expect(describeKeySpaces({ scope: 'user', space_id: null, allowed_space_ids: null }, spaces)).toBe('全スペース')
  })

  it('2件までは名前、それより多ければ件数で出す', () => {
    expect(describeKeySpaces({ scope: 'user', space_id: 's1', allowed_space_ids: ['s1'] }, spaces)).toBe('サンプル商事')
    expect(
      describeKeySpaces({ scope: 'user', space_id: 's1', allowed_space_ids: ['s1', 's2', 's3', 's4'] }, spaces),
    ).toBe('サンプル商事, 新規事業 他2件')
  })
})
