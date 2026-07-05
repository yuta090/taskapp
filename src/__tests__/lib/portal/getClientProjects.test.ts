import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getClientProjects, resolveCurrentProject } from '@/lib/portal/getClientProjects'

/**
 * Regression tests for S6: a client invited to multiple projects (or multiple
 * orgs) could only ever see the first one, because every portal page fetched
 * space_memberships with `.limit(1).single()` (non-deterministic ORDER BY) or
 * always picked `projects[0]`.
 */

interface MembershipQueryResponse {
  data: Array<{
    space_id: string
    spaces: { id: string; name: string; org_id: string; organizations: { id: string; name: string } }
  }> | null
  error: { message: string } | null
}

function buildSupabaseMock(response: MembershipQueryResponse) {
  const order = vi.fn(() => Promise.resolve(response))
  const eqRole = vi.fn(() => ({ order }))
  const eqUser = vi.fn(() => ({ eq: eqRole }))
  const select = vi.fn(() => ({ eq: eqUser }))
  const from = vi.fn(() => ({ select }))
  return { from, order, eqRole, eqUser, select } as unknown as SupabaseClient & {
    order: typeof order
    eqRole: typeof eqRole
    eqUser: typeof eqUser
  }
}

describe('getClientProjects', () => {
  it('fetches every space_membership with role=client, ordered by created_at ascending', async () => {
    const supabase = buildSupabaseMock({
      data: [
        {
          space_id: 'space-1',
          spaces: { id: 'space-1', name: 'プロジェクトA', org_id: 'org-1', organizations: { id: 'org-1', name: '組織A' } },
        },
        {
          space_id: 'space-2',
          spaces: { id: 'space-2', name: 'プロジェクトB', org_id: 'org-2', organizations: { id: 'org-2', name: '組織B' } },
        },
      ],
      error: null,
    })

    const projects = await getClientProjects(supabase, 'user-1')

    expect(projects).toEqual([
      { id: 'space-1', name: 'プロジェクトA', orgId: 'org-1', orgName: '組織A' },
      { id: 'space-2', name: 'プロジェクトB', orgId: 'org-2', orgName: '組織B' },
    ])
    expect(supabase.eqUser).toHaveBeenCalledWith('user_id', 'user-1')
    expect(supabase.eqRole).toHaveBeenCalledWith('role', 'client')
    expect(supabase.order).toHaveBeenCalledWith('created_at', { ascending: true })
  })

  it('returns an empty array (not a throw) when the query errors', async () => {
    const supabase = buildSupabaseMock({ data: null, error: { message: 'boom' } })

    const projects = await getClientProjects(supabase, 'user-1')

    expect(projects).toEqual([])
  })

  it('returns an empty array when the user has no client memberships', async () => {
    const supabase = buildSupabaseMock({ data: [], error: null })

    const projects = await getClientProjects(supabase, 'user-1')

    expect(projects).toEqual([])
  })
})

describe('resolveCurrentProject', () => {
  const projects = [
    { id: 'space-1', name: 'プロジェクトA', orgId: 'org-1', orgName: '組織A' },
    { id: 'space-2', name: 'プロジェクトB', orgId: 'org-2', orgName: '組織B' },
  ]

  it('picks the project matching ?space= when it is one the user belongs to', () => {
    expect(resolveCurrentProject(projects, 'space-2')).toEqual(projects[1])
  })

  it('falls back to the first project when ?space= is missing', () => {
    expect(resolveCurrentProject(projects, undefined)).toEqual(projects[0])
  })

  it('falls back to the first project when ?space= references a space the user is not a member of', () => {
    expect(resolveCurrentProject(projects, 'space-not-mine')).toEqual(projects[0])
  })

  it('handles the array form Next.js gives duplicate query params (?space=a&space=b)', () => {
    expect(resolveCurrentProject(projects, ['space-2', 'space-1'])).toEqual(projects[1])
  })

  it('returns undefined when there are no projects at all', () => {
    expect(resolveCurrentProject([], 'space-1')).toBeUndefined()
  })
})
