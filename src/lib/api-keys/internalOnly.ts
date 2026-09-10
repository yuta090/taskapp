/**
 * API キーは社内メンバー（admin / editor / viewer）専用。相手先（client / vendor）の役割では発行も利用もできない。
 * 利用の拒否の正本は DB の mcp_authorize（役割が後から相手先に変わった既存の鍵も止まる）。
 * ここは発行側（/api/keys/user とアカウントの「APIキー」画面）で同じ条件を二重に守るための判定。
 */
export const EXTERNAL_SPACE_ROLES = ['client', 'vendor'] as const

export function isExternalSpaceRole(role: string | null | undefined): boolean {
  return (EXTERNAL_SPACE_ROLES as readonly string[]).includes(role ?? '')
}
