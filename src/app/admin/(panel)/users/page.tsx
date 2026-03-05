import { createAdminClient } from '@/lib/supabase/admin'
import UsersPageClient, { type UserRow } from './UsersPageClient'

async function fetchUsersData(): Promise<UserRow[]> {
  const admin = createAdminClient()

  const [profilesResult, membershipsResult] = await Promise.all([
    admin.from('profiles').select('id, display_name, is_superadmin, created_at').order('created_at', { ascending: false }),
    admin.from('org_memberships').select('user_id'),
  ])

  if (profilesResult.error) console.error('[admin/users] profiles query error:', profilesResult.error.message)
  if (membershipsResult.error) console.error('[admin/users] org_memberships query error:', membershipsResult.error.message)

  // Fetch user emails via auth.admin (requires service_role key)
  const emailMap = new Map<string, string>()
  try {
    const { data: authData, error: authError } = await admin.auth.admin.listUsers({ perPage: 1000 })
    if (authError) {
      console.error('[admin/users] auth.admin.listUsers error:', authError.message)
    } else {
      for (const u of authData.users) {
        emailMap.set(u.id, u.email ?? '')
      }
      if (authData.users.length >= 1000) {
        console.warn('[admin/users] auth.admin.listUsers returned 1000+ users — pagination may be needed')
      }
    }
  } catch (e: unknown) {
    console.error('[admin/users] auth.admin.listUsers exception:', e instanceof Error ? e.message : e)
  }

  const memberCountMap = new Map<string, number>()
  if (membershipsResult.data) {
    for (const m of membershipsResult.data) {
      const uid = (m as Record<string, unknown>).user_id as string
      memberCountMap.set(uid, (memberCountMap.get(uid) ?? 0) + 1)
    }
  }

  return ((profilesResult.data ?? []) as Array<Record<string, unknown>>).map((profile) => ({
    id: profile.id as string,
    display_name: (profile.display_name as string | null) ?? null,
    email: emailMap.get(profile.id as string) ?? '',
    is_superadmin: profile.is_superadmin as boolean,
    memberships_count: memberCountMap.get(profile.id as string) ?? 0,
    created_at: profile.created_at as string,
  }))
}

export default async function AdminUsersPage() {
  const rows = await fetchUsersData()
  return <UsersPageClient initialData={rows} />
}
