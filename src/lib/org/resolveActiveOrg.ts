import type { SupabaseClient } from '@supabase/supabase-js'

export interface ResolvedOrg {
  org_id: string
  role: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Resolve the active organization for a user.
 *
 * 1. If cookieOrgId is a valid UUID, validate membership
 * 2. If invalid or missing, fall back to the user's first organization (by created_at ASC)
 * 3. Returns null if the user has no memberships
 */
export async function resolveActiveOrg(
  supabase: SupabaseClient,
  userId: string,
  cookieOrgId?: string | null,
): Promise<ResolvedOrg | null> {
  // Step 1: validate cookie org (skip malformed UUIDs to avoid unnecessary DB round-trip)
  if (cookieOrgId && UUID_RE.test(cookieOrgId)) {
    const { data, error } = await supabase
      .from('org_memberships')
      .select('org_id, role')
      .eq('user_id', userId)
      .eq('org_id', cookieOrgId)
      .maybeSingle()

    if (error) {
      console.error('[resolveActiveOrg] cookie validation failed:', error.message)
    }
    if (data) return data as ResolvedOrg
  }

  // Step 2: fallback to first org
  const { data, error } = await supabase
    .from('org_memberships')
    .select('org_id, role')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[resolveActiveOrg] fallback query failed:', error.message)
  }

  return (data as ResolvedOrg) ?? null
}
