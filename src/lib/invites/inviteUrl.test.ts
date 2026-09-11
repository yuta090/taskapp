import { describe, it, expect } from 'vitest'
import { buildInviteUrl } from './inviteUrl'
import { isPublicPathMatch } from '@/lib/routes/publicPaths'

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

  // 本番バグの根本原因はここ: /portal/<token> や /vendor-portal/<token> は
  // 公開パスではないため、未ログインの受信者はログイン画面に弾かれ招待を受諾できなかった。
  // buildInviteUrl の出力は、どの role でも必ず未ログインで開ける（公開パスの）URLでなければならない。
  it.each(['client', 'vendor', 'member', 'admin', 'owner', 'unknown-role'])(
    'role=%s の招待リンクは常に公開パス（未ログインで開ける）を指す',
    (role) => {
      const url = buildInviteUrl(role, 'tok', 'https://agentpm.app')
      const pathname = new URL(url).pathname
      expect(isPublicPathMatch(pathname)).toBe(true)
    }
  )
})
