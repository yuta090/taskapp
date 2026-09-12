import { describe, it, expect } from 'vitest'
import {
  isOrgInternalRole,
  canEditSpaceContent,
  canEditSpaceMoney,
  allowedSpaceRolesFor,
  isReviewApproverRole,
  isSecretaryApproverRole,
} from '@/lib/roles/spaceRoles'

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
// DB側は2段構え: トリガー（guard_agency_settings, 20260308_002／
// guard_task_pricing_write・delete, 20260308_003）が「space_memberships の行が
// はっきり admin/editor」を課し、agency 設定の実体は spaces の列なので、
// RLS（app_can_write_space 経由）の「組織の役割が社内」も同時に満たす必要がある。
// canEditSpaceContent と違い、行が無い社内メンバーへの「editor扱い」フォールバックは無い
// （トリガーは space_memberships を直接引き、行が無ければ caller_role が NULL のまま弾かれる）。
describe('canEditSpaceMoney', () => {
  it('社内メンバーで space の役割が admin なら操作できる', () => {
    expect(canEditSpaceMoney('admin', 'member')).toBe(true)
  })

  it('社内メンバーで space の役割が editor なら操作できる', () => {
    expect(canEditSpaceMoney('editor', 'owner')).toBe(true)
  })

  it('社内メンバーでも space の役割が viewer / client / vendor なら操作できない', () => {
    expect(canEditSpaceMoney('viewer', 'member')).toBe(false)
    expect(canEditSpaceMoney('client', 'member')).toBe(false)
    expect(canEditSpaceMoney('vendor', 'member')).toBe(false)
  })

  it('space_memberships に行が無ければ操作できない（canEditSpaceContentと違いeditor扱いにしない）', () => {
    expect(canEditSpaceMoney(null, 'member')).toBe(false)
    expect(canEditSpaceMoney(undefined, 'owner')).toBe(false)
  })

  it('組織の役割が client（社外）なら、space の役割が admin/editor でも操作できない', () => {
    expect(canEditSpaceMoney('admin', 'client')).toBe(false)
  })

  it('組織の役割が未取得なら操作できない側に倒す', () => {
    expect(canEditSpaceMoney('admin', null)).toBe(false)
    expect(canEditSpaceMoney('admin', undefined)).toBe(false)
  })
})

// 組織の役割と space の役割をそろえる規則（Fable裁定 role-consistency-decision, 2026-09-12）。
// 組織 owner/member（社内）→ space は 管理者/編集者/閲覧者 だけ。
// 組織 client → space は クライアント だけ。代理店モード(spaces.agency_mode)のときだけ ベンダー も選べる。
// 社内メンバーに space の vendor / client は禁止（降格として正式化しない）。
// rpc_review_open（20260911180601_review_request_notify.sql）の
// 「社内承認のレビュアーは社内ロール（admin / editor）のみ」と同じ規則。
describe('isReviewApproverRole', () => {
  it('admin / editor は承認者候補', () => {
    expect(isReviewApproverRole('admin')).toBe(true)
    expect(isReviewApproverRole('editor')).toBe(true)
  })

  it('viewer / client / vendor は承認者候補ではない', () => {
    expect(isReviewApproverRole('viewer')).toBe(false)
    expect(isReviewApproverRole('client')).toBe(false)
    expect(isReviewApproverRole('vendor')).toBe(false)
  })

  it('未取得・不明な役割は承認者候補ではない側に倒す', () => {
    expect(isReviewApproverRole(null)).toBe(false)
    expect(isReviewApproverRole(undefined)).toBe(false)
    expect(isReviewApproverRole('')).toBe(false)
  })
})

// 秘書のタスク承認フロー（グループの「責任者」）用。社内承認(レビュー)の
// isReviewApproverRoleとは別の決まりだが、今は同じ範囲(admin/editor)。
// サーバー側の最終判定は isSpaceApproverEligible（src/lib/channels/store.ts）。
describe('isSecretaryApproverRole', () => {
  it('admin / editor は責任者候補', () => {
    expect(isSecretaryApproverRole('admin')).toBe(true)
    expect(isSecretaryApproverRole('editor')).toBe(true)
  })

  it('viewer / client / vendor は責任者候補ではない', () => {
    expect(isSecretaryApproverRole('viewer')).toBe(false)
    expect(isSecretaryApproverRole('client')).toBe(false)
    expect(isSecretaryApproverRole('vendor')).toBe(false)
  })

  it('未取得・不明な役割は責任者候補ではない側に倒す', () => {
    expect(isSecretaryApproverRole(null)).toBe(false)
    expect(isSecretaryApproverRole(undefined)).toBe(false)
    expect(isSecretaryApproverRole('')).toBe(false)
  })
})

describe('allowedSpaceRolesFor', () => {
  it('組織が owner なら 管理者/編集者/閲覧者 だけ選べる（代理店モードでも変わらない）', () => {
    expect(allowedSpaceRolesFor('owner', false)).toEqual(['admin', 'editor', 'viewer'])
    expect(allowedSpaceRolesFor('owner', true)).toEqual(['admin', 'editor', 'viewer'])
  })

  it('組織が member なら 管理者/編集者/閲覧者 だけ選べる', () => {
    expect(allowedSpaceRolesFor('member', false)).toEqual(['admin', 'editor', 'viewer'])
  })

  it('組織が admin（死に値）でも社内扱いで 管理者/編集者/閲覧者', () => {
    expect(allowedSpaceRolesFor('admin', false)).toEqual(['admin', 'editor', 'viewer'])
  })

  it('組織が client なら、代理店モードでなければ クライアント だけ', () => {
    expect(allowedSpaceRolesFor('client', false)).toEqual(['client'])
  })

  it('組織が client かつ代理店モードなら クライアント と ベンダー が選べる', () => {
    expect(allowedSpaceRolesFor('client', true)).toEqual(['client', 'vendor'])
  })

  it('組織の役割が未取得・不明なら選べる役割は無し（安全側に倒す）', () => {
    expect(allowedSpaceRolesFor(null, false)).toEqual([])
    expect(allowedSpaceRolesFor(undefined, false)).toEqual([])
    expect(allowedSpaceRolesFor('', false)).toEqual([])
    expect(allowedSpaceRolesFor('unknown', false)).toEqual([])
  })
})
