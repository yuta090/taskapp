import { createAdminClient } from '@/lib/supabase/admin'
import OrganizationsPageClient, { type OrgRow } from './OrganizationsPageClient'

async function fetchOrganizationsData(): Promise<OrgRow[]> {
  const admin = createAdminClient()

  const [orgsResult, membershipsResult, spacesResult, billingsResult] = await Promise.all([
    admin.from('organizations').select('id, name, created_at').order('created_at', { ascending: false }),
    admin.from('org_memberships').select('org_id'),
    admin.from('spaces').select('org_id').is('archived_at', null),
    admin.from('org_billing').select('org_id, plan_id, status'),
  ])

  if (orgsResult.error) console.error('[admin/organizations] organizations query error:', orgsResult.error.message)
  if (membershipsResult.error) console.error('[admin/organizations] org_memberships query error:', membershipsResult.error.message)
  if (spacesResult.error) console.error('[admin/organizations] spaces query error:', spacesResult.error.message)
  if (billingsResult.error) console.error('[admin/organizations] org_billing query error:', billingsResult.error.message)

  const memberCountMap = new Map<string, number>()
  const spaceCountMap = new Map<string, number>()
  const billingMap = new Map<string, { plan_id: string; status: string }>()

  if (membershipsResult.data) {
    for (const m of membershipsResult.data) {
      const rec = m as Record<string, unknown>
      const orgId = rec.org_id as string
      memberCountMap.set(orgId, (memberCountMap.get(orgId) ?? 0) + 1)
    }
  }
  if (spacesResult.data) {
    for (const s of spacesResult.data) {
      const rec = s as Record<string, unknown>
      const orgId = rec.org_id as string
      spaceCountMap.set(orgId, (spaceCountMap.get(orgId) ?? 0) + 1)
    }
  }
  if (billingsResult.data) {
    for (const b of billingsResult.data) {
      const rec = b as Record<string, unknown>
      billingMap.set(rec.org_id as string, {
        plan_id: rec.plan_id as string,
        status: rec.status as string,
      })
    }
  }

  return ((orgsResult.data ?? []) as Array<{ id: string; name: string; created_at: string }>).map((org) => {
    const billing = billingMap.get(org.id)
    return {
      id: org.id,
      name: org.name,
      member_count: memberCountMap.get(org.id) ?? 0,
      space_count: spaceCountMap.get(org.id) ?? 0,
      plan: billing?.plan_id ?? 'free',
      status: billing?.status ?? '',
      created_at: org.created_at,
    }
  })
}

export default async function AdminOrganizationsPage() {
  const rows = await fetchOrganizationsData()
  return <OrganizationsPageClient initialData={rows} />
}
