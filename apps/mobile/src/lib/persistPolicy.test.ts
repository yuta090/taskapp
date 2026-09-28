import { describe, expect, it } from 'vitest'
import { AAL_QUERY_KEY, shouldPersistQuery } from './persistPolicy'

describe('shouldPersistQuery', () => {
  it('一覧などのデータは端末に取り置く（次に開いたとき即表示するため）', () => {
    expect(shouldPersistQuery(['myTasks', 'u1', 'o1'])).toBe(true)
    expect(shouldPersistQuery(['inbox', 'u1', 'o1'])).toBe(true)
  })
  it('2段階認証の確認はキーにトークンが入るので取り置かない（暗号化されない保存先にトークンを書かない）', () => {
    expect(shouldPersistQuery([AAL_QUERY_KEY, 'eyJhbGciOi...'])).toBe(false)
  })
})
