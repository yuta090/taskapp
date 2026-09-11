import { describe, it, expect } from 'vitest'
import { isOrgInternalRole, canEditSpaceContent, canEditSpaceMoney } from '@/lib/roles/spaceRoles'

// DB側の判定（app_can_write_space / app_is_org_internal, 20260911143112_space_role_boundary.sql）
// と同じ規則になっているかを確かめる。
describe('isOrgInternalRole', () => {
  it('owner / admin / member は社内メンバー', () => {
    expect(isOrgInternalRole('owner')).toBe(true)
    expect(isOrgInternalRole('admin')).toBe(true)
    expect(isOrgInternalRole('member')).toBe(true)
  })

  it('client（相手先・vendorもorg側はclient）は社内メンバーではない', () => {
    expect(isOrgInternalRole('client')).toBe(false)
  })

  it('未取得・不明な役割は社内メンバーではない側に倒す', () => {
    expect(isOrgInternalRole(null)).toBe(false)
    expect(isOrgInternalRole(undefined)).toBe(false)
    expect(isOrgInternalRole('')).toBe(false)
    expect(isOrgInternalRole('unknown')).toBe(false)
  })
})

describe('canEditSpaceContent', () => {
  it('社内メンバーで space の役割が admin なら編集できる', () => {
    expect(canEditSpaceContent('admin', 'member')).toBe(true)
  })

  it('社内メンバーで space の役割が editor なら編集できる', () => {
    expect(canEditSpaceContent('editor', 'owner')).toBe(true)
  })

  it('社内メンバーで space_memberships に行が無ければ編集者扱い', () => {
    expect(canEditSpaceContent(null, 'member')).toBe(true)
    expect(canEditSpaceContent(undefined, 'owner')).toBe(true)
  })

  it('社内メンバーでも space の役割が viewer なら編集できない', () => {
    expect(canEditSpaceContent('viewer', 'member')).toBe(false)
  })

  it('社内メンバーでも space の役割が client / vendor なら編集できない', () => {
    expect(canEditSpaceContent('client', 'member')).toBe(false)
    expect(canEditSpaceContent('vendor', 'member')).toBe(false)
  })

  it('組織の役割が client（社外）なら、space の役割に関わらず編集できない', () => {
    expect(canEditSpaceContent('admin', 'client')).toBe(false)
    expect(canEditSpaceContent(null, 'client')).toBe(false)
  })

  it('組織の役割が未取得なら編集できない側に倒す', () => {
    expect(canEditSpaceContent('admin', null)).toBe(false)
    expect(canEditSpaceContent('admin', undefined)).toBe(false)
  })
})

// 価格の枠・代理店設定は canEditSpaceContent より狭い規則。
// DB側の判定（guard_agency_settings, 20260308_002／guard_task_pricing_write・delete, 20260308_003）
// と同じ: space_memberships の行がはっきり admin/editor の人だけ。
// canEditSpaceContent と違い、行が無い社内メンバーへの「editor扱い」フォールバックは無い
// （トリガーは space_memberships を直接引き、行が無ければ caller_role が NULL のまま弾かれる）。
// 組織の役割は見ない（トリガー自体が見ていない）。
describe('canEditSpaceMoney', () => {
  it('space の役割が admin なら操作できる', () => {
    expect(canEditSpaceMoney('admin')).toBe(true)
  })

  it('space の役割が editor なら操作できる', () => {
    expect(canEditSpaceMoney('editor')).toBe(true)
  })

  it('space の役割が viewer / client / vendor なら操作できない', () => {
    expect(canEditSpaceMoney('viewer')).toBe(false)
    expect(canEditSpaceMoney('client')).toBe(false)
    expect(canEditSpaceMoney('vendor')).toBe(false)
  })

  it('space_memberships に行が無ければ操作できない（canEditSpaceContentと違いeditor扱いにしない）', () => {
    expect(canEditSpaceMoney(null)).toBe(false)
    expect(canEditSpaceMoney(undefined)).toBe(false)
  })
})
