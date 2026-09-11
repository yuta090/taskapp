/**
 * 招待の入口URL。役割によらず常に招待の受諾画面 /invite/<token>。
 * /portal/<token> や /vendor-portal/<token> は公開ページではないため未ログインだと
 * ログイン画面に飛ばされ、新規の相手先/ベンダーが参加できなくなる。
 * 受諾後の行き先（/portal, /vendor-portal, プロジェクト画面）は招待画面側で役割ごとに振り分ける。
 *
 * メール本文とAPIの戻り値で同じものを使うため、ここを唯一の正本にする。
 */
export function buildInviteUrl(role: string, token: string, appUrl: string): string {
  const base = appUrl.replace(/\/+$/, '')
  return `${base}/invite/${token}`
}
