import { createClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * チャネル配管APIの認可: org内部メンバー(owner/admin/member)のみ。
 * クライアント/ベンダーは不可（秘書の会話ログ・突合コードは内部専用）。
 */

export type InternalAuthResult =
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 403; error: string }

const INTERNAL_ROLES = new Set(['owner', 'admin', 'member'])

export async function requireInternalMember(orgId: string): Promise<InternalAuthResult> {
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

  if (!membership || !INTERNAL_ROLES.has(membership.role as string)) {
    return { ok: false, status: 403, error: 'Internal members only' }
  }

  return { ok: true, userId: user.id }
}
