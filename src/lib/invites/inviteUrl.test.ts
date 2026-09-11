import { describe, it, expect } from 'vitest'
import { buildInviteUrl } from './inviteUrl'

describe('招待リンクの作り方', () => {
  it('社内メンバーは /invite/<合言葉>', () => {
    expect(buildInviteUrl('member', 'tok-1', 'https://agentpm.app')).toBe(
      'https://agentpm.app/invite/tok-1'
    )
  })

  it('相手先（クライアント）も /invite/<合言葉>（承諾後にポータルへ誘導する）', () => {
    expect(buildInviteUrl('client', 'tok-2', 'https://agentpm.app')).toBe(
      'https://agentpm.app/invite/tok-2'
    )
  })

  it('ベンダーも /invite/<合言葉>', () => {
    expect(buildInviteUrl('vendor', 'tok-4', 'https://agentpm.app')).toBe(
      'https://agentpm.app/invite/tok-4'
    )
  })

  it('末尾のスラッシュがあっても二重にしない', () => {
    expect(buildInviteUrl('member', 'tok-3', 'https://agentpm.app/')).toBe(
      'https://agentpm.app/invite/tok-3'
    )
  })
})
