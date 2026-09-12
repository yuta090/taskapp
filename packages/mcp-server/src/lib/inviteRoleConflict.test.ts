import { describe, it, expect } from 'vitest'
import { inviteRoleConflictMessage } from './inviteRoleConflict.js'

describe('inviteRoleConflictMessage（道具側）', () => {
  it('IRC01: 参加している種類に応じて日本語で断る', () => {
    expect(
      inviteRoleConflictMessage({
        code: 'IRC01',
        message: 'invite_org_role_conflict',
        details: 'org_role=member invite_role=client',
      })
    ).toBe('この人はすでに社内メンバーとして参加しているため、この種類では招待できません')

    expect(
      inviteRoleConflictMessage({
        code: 'IRC01',
        message: 'invite_org_role_conflict',
        details: 'org_role=client invite_role=member',
      })
    ).toContain('相手先として参加しているため')
  })

  it('IRC02 / IRC03 も決まった日本語にする', () => {
    expect(inviteRoleConflictMessage({ code: 'IRC02', message: 'invite_pending_kind_conflict' })).toContain(
      '種類の違う承諾待ちの招待'
    )
    expect(inviteRoleConflictMessage({ code: 'IRC03', message: 'invite_vendor_requires_agency_mode' })).toContain(
      '代理店モード'
    )
  })

  it('送り直しのときは案内を変える', () => {
    expect(
      inviteRoleConflictMessage({ code: 'IRC01', message: 'invite_org_role_conflict' }, 'resend')
    ).toContain('送り直せません')
  })

  it('この3つ以外は null（英語の文言は呼び手に返さない）', () => {
    expect(inviteRoleConflictMessage({ code: '23505', message: 'duplicate key value' })).toBeNull()
    expect(inviteRoleConflictMessage(null)).toBeNull()
  })
})
