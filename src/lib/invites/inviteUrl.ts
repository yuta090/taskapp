/**
 * 招待の入口URL。役割ごとに行き先が違う。
 * - 社内メンバー(member): アプリの招待画面 /invite/<token>
 * - 相手先(client): クライアントポータル /portal/<token>
 *
 * メール本文とAPIの戻り値で同じものを使うため、ここを唯一の正本にする。
 */
export function buildInviteUrl(role: string, token: string, appUrl: string): string {
  const base = appUrl.replace(/\/+$/, '')
  return role === 'client' ? `${base}/portal/${token}` : `${base}/invite/${token}`
}
