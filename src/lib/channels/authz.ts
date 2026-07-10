import { createClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * チャネル配管APIの認可: org内部メンバー(owner/admin/member)のみ。
 * クライアント/ベンダーは不可（秘書の会話ログ・突合コードは内部専用）。
 * bot有効/無効の切替等、破壊的な操作は requireOrgAdmin（owner/adminのみ）を使う。
 */

export type InternalRole = 'owner' | 'admin' | 'member'

export type InternalAuthResult =
  | { ok: true; userId: string; role: InternalRole }
  | { ok: false; status: 401 | 403; error: string }

const INTERNAL_ROLES = new Set<string>(['owner', 'admin', 'member'])
const ADMIN_ROLES = new Set<string>(['owner', 'admin'])

async function resolveMembership(
  orgId: string,
): Promise<
  | { ok: true; userId: string; role: string }
  | { ok: false; status: 401; error: string }
  | { ok: false; status: 403; error: 'no membership' }
> {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    return { ok: false, status: 401, error: 'Unauthorized' }
  }

  const { data: membership } = await (supabase as SupabaseClient)
    .from('org_memberships')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return { ok: false, status: 403, error: 'no membership' }
  }

  return { ok: true, userId: user.id, role: membership.role as string }
}

export async function requireInternalMember(orgId: string): Promise<InternalAuthResult> {
  const result = await resolveMembership(orgId)
  if (!result.ok) {
    return result.status === 401
      ? result
      : { ok: false, status: 403, error: 'Internal members only' }
  }
  if (!INTERNAL_ROLES.has(result.role)) {
    return { ok: false, status: 403, error: 'Internal members only' }
  }
  return { ok: true, userId: result.userId, role: result.role as InternalRole }
}

/** owner/adminのみ。bot有効/無効の切替等、事務所の運用に影響する操作用 */
export async function requireOrgAdmin(orgId: string): Promise<InternalAuthResult> {
  const result = await resolveMembership(orgId)
  if (!result.ok) {
    return result.status === 401
      ? result
      : { ok: false, status: 403, error: 'Owner or admin only' }
  }
  if (!ADMIN_ROLES.has(result.role)) {
    return { ok: false, status: 403, error: 'Owner or admin only' }
  }
  return { ok: true, userId: result.userId, role: result.role as InternalRole }
}
