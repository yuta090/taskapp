import { describe, it, expect } from 'vitest'
import { pendingInviteLabel } from '@/lib/hooks/useSpacePendingInvites'

/** 担当者の選択肢に出す表示名。名前があれば名前、無ければメール。どちらも「招待中」と分かるようにする */
describe('pendingInviteLabel', () => {
  it('名前があれば名前に（招待中）を付ける', () => {
    expect(pendingInviteLabel({ id: 'i1', email: 'tabata@example.co.jp', inviteeName: '田畠', role: 'member' })).toBe('田畠（招待中）')
  })
  it('名前が無ければメールに（招待中）を付ける', () => {
    expect(pendingInviteLabel({ id: 'i1', email: 'tabata@example.co.jp', inviteeName: null, role: 'member' })).toBe('tabata@example.co.jp（招待中）')
  })
})
