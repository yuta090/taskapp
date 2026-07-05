import type { SupabaseClient } from '@supabase/supabase-js'

export interface PortalProject {
  id: string
  name: string
  orgId: string
  orgName?: string
}

interface MembershipRow {
  space_id: string
  spaces?: {
    name?: string
    org_id?: string
    organizations?: { name?: string } | null
  } | null
}

/**
 * Fetches every space the given user is a *client* member of, ordered by
 * created_at ascending so the result is deterministic.
 *
 * S6 bug: portal pages used to fetch a single membership with
 * `.limit(1).single()` (no ORDER BY — non-deterministic) or fetched every
 * membership but always rendered `projects[0]`, so a client invited to
 * multiple projects/orgs could only ever see the first one.
 */
export async function getClientProjects(
  supabase: SupabaseClient,
  userId: string,
): Promise<PortalProject[]> {
  const { data, error } = await supabase
    .from('space_memberships')
    .select(`
      space_id,
      spaces!inner (
        id,
        name,
        org_id,
        organizations!inner (
          id,
          name
        )
      )
    `)
    .eq('user_id', userId)
    .eq('role', 'client')
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[Portal] getClientProjects query error:', error)
    return []
  }

  return ((data || []) as unknown as MembershipRow[]).map((m) => ({
    id: m.space_id,
    name: m.spaces?.name || 'プロジェクト',
    orgId: m.spaces?.org_id || '',
    orgName: m.spaces?.organizations?.name || '組織',
  }))
}

/**
 * Resolves which project a portal page should render for, given the
 * `?space=` query param. Falls back to the first project (in the
 * deterministic order from getClientProjects) when the param is absent, or
 * when it points at a space the user does not belong to — never an error,
 * since a stale/tampered link shouldn't lock the client out.
 */
export function resolveCurrentProject(
  projects: PortalProject[],
  spaceIdParam?: string | string[],
): PortalProject | undefined {
  const spaceId = Array.isArray(spaceIdParam) ? spaceIdParam[0] : spaceIdParam
  const found = spaceId ? projects.find((p) => p.id === spaceId) : undefined
  return found ?? projects[0]
}
