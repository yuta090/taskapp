/**
 * 招待がいまどの状態か（純粋関数）。
 * invites には状態の列が無く、承諾日時と期限から決まる。画面と API で同じ判定を使う。
 */
export type InviteStatus = 'accepted' | 'expired' | 'pending'

export const INVITE_STATUS_LABEL: Record<InviteStatus, string> = {
  accepted: '参加済み',
  expired: '期限切れ',
  pending: '返事待ち',
}

export function inviteStatus(
  invite: { accepted_at: string | null; expires_at: string },
  now: number = Date.now(),
): InviteStatus {
  if (invite.accepted_at) return 'accepted'
  if (new Date(invite.expires_at).getTime() <= now) return 'expired'
  return 'pending'
}
