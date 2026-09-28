import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * 外部チャットとの接続を、その人に許してよいか。
 *
 * ⚠ 相手先（client）・協力会社（vendor）は接続できない。API キーと同じ扱いで、
 * 社内メンバー専用にする（DB 側でも mcp_authorize が同じ判断をするが、
 * 同意画面でも先に弾いて理由を見せる）。
 */

/** 外部チャットにつないでよい組織の役割 */
const ALLOWED_ORG_ROLES = new Set(['owner', 'admin', 'member'])

export interface ConnectableOrg {
  orgId: string
  orgName: string
  role: string
}

/** その人が外部チャットにつなげる組織の一覧。1つも無ければ空 */
export async function listConnectableOrgs(
  supabase: SupabaseClient,
  userId: string,
): Promise<ConnectableOrg[]> {
  const { data, error } = await supabase
    .from('org_memberships')
    .select('org_id, role, organizations(name)')
    .eq('user_id', userId)

  if (error || !data) return []

  return (data as unknown as { org_id: string; role: string; organizations: { name: string } | null }[])
    .filter((row) => ALLOWED_ORG_ROLES.has(row.role))
    .map((row) => ({
      orgId: row.org_id,
      orgName: row.organizations?.name || '（名称未設定）',
      role: row.role,
    }))
}

/** その組織につないでよいか（同意の直前にもう一度確かめる） */
export async function canConnectOrg(
  supabase: SupabaseClient,
  userId: string,
  orgId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('org_memberships')
    .select('role')
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .maybeSingle()

  return !!data && ALLOWED_ORG_ROLES.has(data.role)
}

/** 同意画面で選べる操作の範囲 */
export type ConsentLevel = 'read' | 'write'

export function actionsForLevel(level: ConsentLevel): string[] {
  // 消す・一括は OAuth では出さない（画面で発行する鍵でのみ使える）
  return level === 'write' ? ['read', 'write'] : ['read']
}

export function isConsentLevel(value: unknown): value is ConsentLevel {
  return value === 'read' || value === 'write'
}
