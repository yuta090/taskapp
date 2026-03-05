import { createAdminClient } from '@/lib/supabase/admin'
import SpacesPageClient, { type SpaceRow } from './SpacesPageClient'

async function fetchSpacesData(): Promise<SpaceRow[]> {
  const admin = createAdminClient()

  const [spacesResult, orgsResult, tasksResult, membersResult] = await Promise.all([
    admin.from('spaces').select('id, org_id, name, type, archived_at, created_at').order('created_at', { ascending: false }),
    admin.from('organizations').select('id, name'),
    admin.from('tasks').select('space_id'),
    admin.from('space_memberships').select('space_id'),
  ])

  if (spacesResult.error) console.error('[admin/spaces] spaces query error:', spacesResult.error.message)
  if (orgsResult.error) console.error('[admin/spaces] organizations query error:', orgsResult.error.message)
  if (tasksResult.error) console.error('[admin/spaces] tasks query error:', tasksResult.error.message)
  if (membersResult.error) console.error('[admin/spaces] space_memberships query error:', membersResult.error.message)

  const orgMap = new Map<string, string>()
  if (orgsResult.data) {
    for (const o of orgsResult.data) {
      const rec = o as Record<string, unknown>
      orgMap.set(rec.id as string, rec.name as string)
    }
  }

  const taskCountMap = new Map<string, number>()
  if (tasksResult.data) {
    for (const t of tasksResult.data) {
      const rec = t as Record<string, unknown>
      const spaceId = rec.space_id as string
      taskCountMap.set(spaceId, (taskCountMap.get(spaceId) ?? 0) + 1)
    }
  }

  const memberCountMap = new Map<string, number>()
  if (membersResult.data) {
    for (const m of membersResult.data) {
      const rec = m as Record<string, unknown>
      const spaceId = rec.space_id as string
      memberCountMap.set(spaceId, (memberCountMap.get(spaceId) ?? 0) + 1)
    }
  }

  return ((spacesResult.data ?? []) as Array<Record<string, unknown>>).map((space) => ({
    id: space.id as string,
    name: space.name as string,
    org_name: orgMap.get(space.org_id as string) ?? '-',
    type: space.type as string,
    member_count: memberCountMap.get(space.id as string) ?? 0,
    task_count: taskCountMap.get(space.id as string) ?? 0,
    status: space.archived_at ? 'archived' : 'active',
    created_at: space.created_at as string,
  }))
}

export default async function AdminSpacesPage() {
  const rows = await fetchSpacesData()
  return <SpacesPageClient initialData={rows} />
}
