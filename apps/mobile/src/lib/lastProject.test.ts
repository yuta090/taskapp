import { describe, expect, it } from 'vitest'
import { LAST_PROJECT_KEY_PREFIX, lastProjectKey, pickRestorableProject } from './lastProject'

describe('lastProjectKey', () => {
  it('ユーザーと組織の組ごとに別のキーになる', () => {
    expect(lastProjectKey('u1', 'o1')).toBe('agentpm-last-project:u1:o1')
    expect(lastProjectKey('u1', 'o1')).not.toBe(lastProjectKey('u2', 'o1'))
    expect(lastProjectKey('u1', 'o1')).not.toBe(lastProjectKey('u1', 'o2'))
  })

  it('キーは共通の接頭辞で始まる（ログアウト時にまとめて消せる）', () => {
    expect(lastProjectKey('u1', 'o1').startsWith(LAST_PROJECT_KEY_PREFIX)).toBe(true)
  })
})

describe('pickRestorableProject', () => {
  const projects = [{ id: 'a' }, { id: 'b' }]

  it('一覧にあれば、その id を返す', () => {
    expect(pickRestorableProject(projects, 'b')).toBe('b')
  })

  it('一覧に無ければ null（アーカイブ・削除・権限なし）', () => {
    expect(pickRestorableProject(projects, 'x')).toBeNull()
  })

  it('保存が無ければ null', () => {
    expect(pickRestorableProject(projects, null)).toBeNull()
    expect(pickRestorableProject(projects, undefined)).toBeNull()
    expect(pickRestorableProject(projects, '')).toBeNull()
  })

  it('一覧が空なら null', () => {
    expect(pickRestorableProject([], 'a')).toBeNull()
  })
})
