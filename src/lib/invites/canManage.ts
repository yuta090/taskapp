/**
 * 招待を「取り消す・もう一度送る」ことができる人か（純粋関数）。
 *
 * 事務所のオーナー/管理者は事務所ぜんぶ。加えて、そのプロジェクトの管理者も自分のプロジェクトの
 * 招待なら扱える（期限切れの招待を見つけたその場で送り直せるように）。
 * 編集者は招待は出せるが、取り消し・送り直しはできない。
 */
export function canManageInvite(
  orgRole: string | null | undefined,
  spaceRole: string | null | undefined,
): boolean {
  // 事務所に属していない人は対象外（クライアントもここで落ちる）
  if (orgRole !== 'owner' && orgRole !== 'admin' && orgRole !== 'member') return false
  if (orgRole === 'owner' || orgRole === 'admin') return true
  return spaceRole === 'admin'
}
