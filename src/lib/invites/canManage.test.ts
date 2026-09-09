import { describe, it, expect } from 'vitest'
import { canManageInvite } from './canManage'

describe('canManageInvite', () => {
  it('事務所のオーナーは、どのプロジェクトの招待でも扱える', () => {
    expect(canManageInvite('owner', null)).toBe(true)
    expect(canManageInvite('owner', 'viewer')).toBe(true)
  })

  it('事務所の管理者も扱える', () => {
    expect(canManageInvite('admin', null)).toBe(true)
  })

  it('プロジェクトの管理者は、自分のプロジェクトの招待を扱える', () => {
    expect(canManageInvite('member', 'admin')).toBe(true)
  })

  it('編集者・閲覧者は扱えない（招待は出せる人でも）', () => {
    expect(canManageInvite('member', 'editor')).toBe(false)
    expect(canManageInvite('member', 'viewer')).toBe(false)
    expect(canManageInvite('member', null)).toBe(false)
  })

  it('事務所に属していない人は、プロジェクトの管理者でも扱えない', () => {
    expect(canManageInvite('client', 'admin')).toBe(false)
    expect(canManageInvite(null, 'admin')).toBe(false)
    expect(canManageInvite(undefined, 'admin')).toBe(false)
  })
})
