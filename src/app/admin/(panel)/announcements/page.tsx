import { createAdminClient } from '@/lib/supabase/admin'
import AnnouncementsPageClient, { type AnnouncementRow, type OrgOption } from './AnnouncementsPageClient'

export default async function AdminAnnouncementsPage() {
  const admin = createAdminClient()

  const [announcementsResult, orgsResult] = await Promise.all([
    admin
      .from('announcements')
      .select('id, org_id, title, body, category, published, created_at')
      .order('created_at', { ascending: false })
      .limit(200),
    admin
      .from('organizations')
      .select('id, name')
      .order('name'),
  ])

  const announcements = (announcementsResult.data ?? []) as Array<Record<string, unknown>>
  const orgs: OrgOption[] = ((orgsResult.data ?? []) as Array<Record<string, unknown>>).map((o) => ({
    id: o.id as string,
    name: o.name as string,
  }))

  // Build org name map
  const orgMap = new Map(orgs.map((o) => [o.id, o.name]))

  // Get read counts per announcement
  const announcementIds = announcements.map((a) => a.id as string)
  let readCounts = new Map<string, number>()

  if (announcementIds.length > 0) {
    const { data: reads } = await admin
      .from('announcement_reads')
      .select('announcement_id')
      .in('announcement_id', announcementIds)

    if (reads) {
      for (const r of reads as Array<Record<string, unknown>>) {
        const aid = r.announcement_id as string
        readCounts.set(aid, (readCounts.get(aid) ?? 0) + 1)
      }
    }
  }

  const rows: AnnouncementRow[] = announcements.map((a) => ({
    id: a.id as string,
    org_id: a.org_id as string | null,
    org_name: a.org_id ? orgMap.get(a.org_id as string) ?? null : null,
    title: a.title as string,
    body: a.body as string,
    category: a.category as AnnouncementRow['category'],
    published: a.published as boolean,
    created_at: a.created_at as string,
    read_count: readCounts.get(a.id as string) ?? 0,
  }))

  return <AnnouncementsPageClient initialData={rows} orgs={orgs} />
}
