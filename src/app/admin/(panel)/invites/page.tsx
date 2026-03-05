import { createAdminClient } from '@/lib/supabase/admin'
import InvitesPageClient, { type InviteRow } from './InvitesPageClient'

function computeStatus(
  acceptedAt: string | null,
  expiresAt: string,
  now: number,
): { label: string; variant: 'success' | 'danger' | 'warning' } {
  if (acceptedAt) return { label: '承認済み', variant: 'success' }
  if (new Date(expiresAt).getTime() < now) return { label: '期限切れ', variant: 'danger' }
  return { label: '未承認', variant: 'warning' }
}

async function fetchInvitesData(): Promise<InviteRow[]> {
  const admin = createAdminClient()
  const now = Date.now()

  const [invitesResult, orgsResult, spacesResult] = await Promise.all([
    admin.from('invites').select('id, org_id, space_id, email, role, expires_at, accepted_at, created_at').order('created_at', { ascending: false }),
    admin.from('organizations').select('id, name'),
    admin.from('spaces').select('id, name'),
  ])

  if (invitesResult.error) console.error('[admin/invites] invites query error:', invitesResult.error.message)
  if (orgsResult.error) console.error('[admin/invites] organizations query error:', orgsResult.error.message)
  if (spacesResult.error) console.error('[admin/invites] spaces query error:', spacesResult.error.message)

  const orgMap = new Map<string, string>()
  ;((orgsResult.data as Array<{ id: string; name: string }>) ?? []).forEach((o) => orgMap.set(o.id, o.name))
  const spaceMap = new Map<string, string>()
  ;((spacesResult.data as Array<{ id: string; name: string }>) ?? []).forEach((s) => spaceMap.set(s.id, s.name))

  return ((invitesResult.data as Array<{
    id: string; org_id: string; space_id: string; email: string
    role: string; expires_at: string; accepted_at: string | null; created_at: string
  }>) ?? []).map((inv) => {
    const status = computeStatus(inv.accepted_at, inv.expires_at, now)
    return {
      ...inv,
      orgName: orgMap.get(inv.org_id) ?? '-',
      spaceName: spaceMap.get(inv.space_id) ?? '-',
      statusLabel: status.label,
      statusVariant: status.variant,
    }
  })
}

export default async function AdminInvitesPage() {
  const rows = await fetchInvitesData()
  return <InvitesPageClient initialData={rows} />
}
