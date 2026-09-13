import { createAdminClient } from '@/lib/supabase/admin'
import { mapWithConcurrency, EMAIL_LOOKUP_CONCURRENCY } from '@/lib/admin/concurrency'
import { resolveActorName } from '@/lib/admin/actorName'

export interface AuditLogRow {
  id: string
  event_type: string
  summary: string | null
  occurred_at: string
  relativeTime: string
  actor_id: string | null
  actorName: string
}

function computeRelativeTime(isoString: string, nowMs: number): string {
  const diff = nowMs - new Date(isoString).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'たった今'
  if (minutes < 60) return `${minutes}分前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}時間前`
  const days = Math.floor(hours / 24)
  return `${days}日前`
}

export async function fetchRecentActivity(): Promise<AuditLogRow[]> {
  const admin = createAdminClient()
  const nowMs = Date.now()

  const { data, error } = await admin
    .from('audit_logs')
    .select('id, event_type, summary, occurred_at, actor_id')
    .order('occurred_at', { ascending: false })
    .limit(8)

  if (error) {
    console.error('[admin/dashboard] audit_logs query error:', error.message)
    return []
  }

  type RawRow = {
    id: string
    event_type: string
    summary: string | null
    occurred_at: string
    actor_id: string | null
  }

  const rows = ((data as unknown) as RawRow[] | null) ?? []

  // audit_logs→profilesの外部キーは無いため埋め込みは使えない。表示名は別問い合わせで
  // まとめて引く(adminはservice roleなので全員分読める)
  const actorIds = [...new Set(rows.map((row) => row.actor_id).filter((id): id is string => !!id))]
  const { data: actorProfiles, error: actorProfilesError } = actorIds.length > 0
    ? await admin.from('profiles').select('id, display_name').in('id', actorIds)
    : { data: [] as { id: string; display_name: string | null }[], error: null }
  if (actorProfilesError) console.error('[admin/dashboard] profiles query error:', actorProfilesError.message)
  const displayNameByActorId = new Map<string, string | null>(
    (actorProfiles || []).map((p) => [p.id, p.display_name]),
  )

  // 表示名が無い行だけ、メールを管理用の鍵(admin.auth.admin)で補う
  const missingActorIds = [
    ...new Set(
      rows
        .filter((row) => row.actor_id && !displayNameByActorId.get(row.actor_id))
        .map((row) => row.actor_id as string)
    ),
  ]
  const missingActorEmails = await mapWithConcurrency(
    missingActorIds,
    EMAIL_LOOKUP_CONCURRENCY,
    async (id): Promise<[string, string | null]> => {
      const { data: authUser } = await admin.auth.admin.getUserById(id)
      return [id, authUser.user?.email ?? null]
    },
  )
  const emailByActorId = new Map<string, string>(
    missingActorEmails.filter((e): e is [string, string] => !!e[1]),
  )

  return rows.map((row) => ({
    id: row.id,
    event_type: row.event_type,
    summary: row.summary,
    occurred_at: row.occurred_at,
    actor_id: row.actor_id,
    actorName: resolveActorName(
      row.actor_id ? displayNameByActorId.get(row.actor_id) : undefined,
      row.actor_id ? emailByActorId.get(row.actor_id) : undefined,
    ),
    relativeTime: computeRelativeTime(row.occurred_at, nowMs),
  }))
}
