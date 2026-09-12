import { describe, it, expect } from 'vitest'
import { inviteRoleConflictMessage } from './roleConflictMessage'

describe('inviteRoleConflictMessage', () => {
  it('IRC01: すでに社内メンバーなら、相手先として招待できないと伝える', () => {
    const msg = inviteRoleConflictMessage({
      code: 'IRC01',
      message: 'invite_org_role_conflict',
      details: 'org_role=member invite_role=client',
    })

    expect(msg).toBe('この人はすでに社内メンバーとして参加しているため、この種類では招待できません')
  })

  it('IRC01: すでに相手先なら、社内メンバーとして招待できないと伝える', () => {
    const msg = inviteRoleConflictMessage({
      code: 'IRC01',
      message: 'invite_org_role_conflict',
      details: 'org_role=client invite_role=member',
    })

    expect(msg).toContain('相手先として参加しているため')
  })

  it('IRC01: DETAIL が無くても日本語で断る', () => {
    const msg = inviteRoleConflictMessage({ code: 'IRC01', message: 'invite_org_role_conflict' })

    expect(msg).toContain('別の種類のメンバー')
    expect(msg).not.toContain('invite_org_role_conflict')
  })

  it('IRC01: 送り直しのときは「取り消してください」と案内する', () => {
    const msg = inviteRoleConflictMessage(
      { code: 'IRC01', message: 'invite_org_role_conflict', details: 'org_role=client invite_role=member' },
      'resend'
    )

    expect(msg).toContain('送り直せません')
    expect(msg).toContain('取り消して')
  })

  it('IRC02: 種類の違う承諾待ちがあることと、次にすることを伝える', () => {
    const msg = inviteRoleConflictMessage({ code: 'IRC02', message: 'invite_pending_kind_conflict' })

    expect(msg).toBe('同じメールアドレスに、種類の違う承諾待ちの招待があります。先にその招待を取り消してください。')
  })

  it('IRC03: 協力会社は代理店モードのプロジェクトだけと伝える', () => {
    expect(inviteRoleConflictMessage({ code: 'IRC03', message: 'invite_vendor_requires_agency_mode' })).toContain(
      '代理店モード'
    )
    expect(
      inviteRoleConflictMessage({ code: 'IRC03', message: 'invite_vendor_requires_agency_mode' }, 'resend')
    ).toContain('送り直せる')
  })

  it('符号が無くても、決まった message で見分けられる', () => {
    expect(inviteRoleConflictMessage({ message: 'invite_pending_kind_conflict' })).toContain('承諾待ち')
  })

  it('この3つ以外は null（呼び出し側は今までどおり扱う）', () => {
    expect(inviteRoleConflictMessage({ code: '23505', message: 'duplicate key value' })).toBeNull()
    expect(inviteRoleConflictMessage(null)).toBeNull()
    expect(inviteRoleConflictMessage(undefined)).toBeNull()
  })
})
