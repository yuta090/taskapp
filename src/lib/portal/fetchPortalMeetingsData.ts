import type { SupabaseClient } from '@supabase/supabase-js'
import { collectRemainingPages, TASKS_PAGE_SIZE } from '@/lib/supabase/queries'

/**
 * `/portal/meetings`（お客さん向けポータルの会議一覧）が使う会議1件分の形。
 * PortalMeetingsClient にそのまま渡す表示用の形（held_at → heldAt 等）に整形済み。
 */
export interface PortalMeetingRow {
  id: string
  title: string
  heldAt: string
  status: string
  minutesMd: string | null
  summarySubject: string | null
  summaryBody: string | null
  startedAt: string | null
  endedAt: string | null
}

export interface PortalMeetingsData {
  meetings: PortalMeetingRow[]
  actionCount: number
}

type RawMeetingRow = {
  id: string
  title: string
  held_at: string | null
  status: string
  minutes_md: string | null
  summary_subject: string | null
  summary_body: string | null
  started_at: string | null
  ended_at: string | null
}

const MEETING_COLUMNS = `
  id,
  title,
  held_at,
  status,
  minutes_md,
  summary_subject,
  summary_body,
  started_at,
  ended_at
` as const

/** meetings テーブルから1ページ分（range指定）を取得する */
function fetchMeetingsPage(supabase: SupabaseClient, spaceId: string, from: number, to: number) {
  return supabase
    .from('meetings')
    .select(MEETING_COLUMNS)
    .eq('space_id', spaceId)
    .in('status', ['ended', 'in_progress'])
    // held_at だけだと同時刻登録で並び順が安定しないため、id をタイブレークに使う
    // （queries.ts の fetchMeetingsQuery と同じ考え方）。
    .order('held_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, to)
}

/**
 * Fetch meetings + actionCount for the client-facing portal meetings page.
 *
 * 以前は `.limit(50)` で最新50件のみを返しており、週次ミーティング等で会議数が
 * 51件を超えるプロジェクトでは古い会議が一覧から静かに消えていた。tasks /
 * fetchMeetingsQuery と同じ range ページング（TASKS_PAGE_SIZE / collectRemainingPages）
 * で全件読み切る。
 *
 * ポータルはサーバーコンポーネントから直接呼ばれ、失敗時に例外を投げると画面全体が
 * エラーページに落ちてしまうため、社内一覧（fetchMeetingsQuery）と異なり
 * graceful degradation を守る:
 *   - 1ページ目の取得が失敗 → 空データで続行（従来どおり）
 *   - 2ページ目以降の取得が失敗 → それまでに読めたページ（1ページ目以降）で続行
 */
export async function fetchPortalMeetingsData(
  supabase: SupabaseClient,
  spaceId: string
): Promise<PortalMeetingsData> {
  const [firstPageResult, actionCountResult] = await Promise.all([
    fetchMeetingsPage(supabase, spaceId, 0, TASKS_PAGE_SIZE - 1),
    supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('space_id', spaceId)
      .eq('ball', 'client')
      .neq('status', 'done'),
  ])

  if (actionCountResult.error) {
    console.error('[Portal Meetings] actionCount query error:', actionCountResult.error)
  }
  const actionCount = actionCountResult.count || 0

  if (firstPageResult.error) {
    console.error('[Portal Meetings] meetings query error:', firstPageResult.error)
    return { meetings: [], actionCount }
  }

  const firstPageRows = (firstPageResult.data || []) as RawMeetingRow[]

  let rawMeetings: RawMeetingRow[] = firstPageRows
  try {
    rawMeetings = await collectRemainingPages(
      firstPageRows,
      (from, to) => fetchMeetingsPage(supabase, spaceId, from, to),
      TASKS_PAGE_SIZE
    )
  } catch (err) {
    // ページ跨ぎの取得失敗はページ全体を落とさず、読めた分だけで続行する
    console.error('[Portal Meetings] meetings pagination error, showing already-loaded pages only:', err)
    rawMeetings = firstPageRows
  }

  const meetings: PortalMeetingRow[] = rawMeetings.map((m) => ({
    id: m.id,
    title: m.title,
    heldAt: m.held_at || '',
    status: m.status,
    minutesMd: m.minutes_md,
    summarySubject: m.summary_subject,
    summaryBody: m.summary_body,
    startedAt: m.started_at,
    endedAt: m.ended_at,
  }))

  return { meetings, actionCount }
}
