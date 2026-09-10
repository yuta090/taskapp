import { describe, it, expect } from 'vitest'
import { canManageSpaceKeys } from '@/lib/api-keys/permissions'

/**
 * プロジェクトの APIキー（発行・一覧・削除）を扱えるのは、組織の owner とそのプロジェクトの admin だけ。
 * プロジェクト設定の「API設定」の画面が見せている条件（管理者限定）と同じ条件をサーバーでも使う。
 */
describe('canManageSpaceKeys', () => {
  it('組織の owner は、プロジェクトでの役割に関係なく扱える', () => {
    expect(canManageSpaceKeys('owner', null)).toBe(true)
    expect(canManageSpaceKeys('owner', 'viewer')).toBe(true)
  })

  it('プロジェクトの admin は扱える', () => {
    expect(canManageSpaceKeys('member', 'admin')).toBe(true)
  })

  it('editor・viewer・相手先・プロジェクト外のメンバーは扱えない', () => {
    expect(canManageSpaceKeys('member', 'editor')).toBe(false)
    expect(canManageSpaceKeys('member', 'viewer')).toBe(false)
    expect(canManageSpaceKeys('client', 'client')).toBe(false)
    expect(canManageSpaceKeys('member', null)).toBe(false)
  })
})
