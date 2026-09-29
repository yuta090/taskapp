import { supabase } from './supabase'

export interface OrgChoice {
  orgId: string
  orgName: string
  role: string
}

/** 自分が入っている組織（古い順。Web の resolveActiveOrg が最初に選ぶのと同じ並び） */
export async function fetchMyOrgs(userId: string): Promise<OrgChoice[]> {
  const { data, error } = await supabase
    .from('org_memberships')
    .select('org_id, role, organizations(name)')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
  if (error) throw error
  const rows = (data ?? []) as unknown as { org_id: string; role: string; organizations: { name: string } | null }[]
  return rows.map((row) => ({ orgId: row.org_id, orgName: row.organizations?.name ?? '（名前なし）', role: row.role }))
}
