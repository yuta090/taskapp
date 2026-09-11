/**
 * Shared query functions for Supabase data fetching.
 *
 * These functions are the single source of truth for data shapes —
 * used by both server prefetch (prefetch.ts) and client hooks (useTasks, etc.).
 * This prevents drift between server and client query logic.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Task, TaskOwner, Milestone, Meeting, MeetingParticipant } from '@/types/database'

// ── Shared data types ──

export type ReviewStatus = 'open' | 'approved' | 'changes_requested' | 'cancelled'

export interface TasksQueryData {
  tasks: Task[]
  owners: Record<string, TaskOwner[]>
  reviewStatuses: Record<string, ReviewStatus>
}

export interface MeetingsQueryData {
  meetings: Meeting[]
  participants: Record<string, MeetingParticipant[]>
}

/**
 * Meeting list columns。
 *
 * - notes はどの画面でも読んでいないため除く（一覧の全件ぶん読まれ、ブラウザの永続
 *   キャッシュ(IndexedDB)にも保存されてしまうだけの無駄）。
 * - minutes_md（議事録本文）は詳細パネル専用で、一覧には含めない。開いたときに
 *   useMeetings.fetchMeetingDetail が `MEETING_DETAIL_COLUMNS` でオンデマンド取得する。
 *   一覧の行が `minutes_md === undefined`（selectで列自体を返していない）のままである
 *   こと自体が「詳細をまだ取っていない」の目印(MeetingsPageClient)になっているため、
 *   null 等に揃えてはいけない。
 */
export const MEETING_LIST_COLUMNS = `
  id, org_id, space_id, title, held_at, status,
  started_at, ended_at, summary_subject, summary_body,
  created_at, updated_at,
  meeting_participants (*)
` as const

/**
 * Meeting detail columns。会議の詳細（議事録本文）をオンデマンド取得するときに使う。
 *
 * 画面で使う列だけ（一覧の列 + minutes_md）。notes・milestone_id・created_by・
 * meeting_url・external_meeting_id・video_provider は読まない。
 */
export const MEETING_DETAIL_COLUMNS = `
  id, org_id, space_id, title, held_at, status,
  started_at, ended_at, minutes_md, summary_subject, summary_body,
  created_at, updated_at
` as const

// ── Shared query functions ──

/**
 * tasks クエリ1ページあたりの件数。
 *
 * - これは「1回のリクエストで返る上限」であって、プロジェクトの想定タスク数の固定値ではない。
 *   204件のプロジェクトなら1回のリクエストで204件がそのまま返る（ページングは発生しない）。
 * - PostgREST（Supabase）は1リクエストあたりデフォルトで最大1000件までしか返さないため、
 *   range を明示せずに全件取得しようとしても、1000件を超えるプロジェクトでは黙って
 *   打ち切られてしまう。そのため常に range ページングで明示的に全ページを読み切る。
 * - 下の「ちょうど上限件数なら次ページがあるとみなす」という停止条件は、サーバー側の
 *   max_rows がこの値（1000）以上であることが前提（`supabase/config.toml` の
 *   `[api] max_rows = 1000` = Supabaseのデフォルト）。max_rows をこれより下げると、
 *   1ページ目が「ちょうど上限」に見えないまま黙って打ち切られる状態に逆戻りするので注意。
 * - 見直しの目安: 実際に1,000件を超えて2ページ目以降が発生するプロジェクトが出てきた場合、
 *   または tasks レスポンスの生サイズが約1MBを超える／再取得のp95が1秒を超える／
 *   Gantt の初回描画が500msを超える、のいずれかに達したら、案C（オープンタスクは常に全件、
 *   完了タスクは遅延読み込み/「もっと見る」・ダッシュボードの完了件数はサーバー側count・
 *   Ganttも同じ絞り込み対象に乗せる）へ移行する。
 */
export const TASKS_PAGE_SIZE = 1000

/**
 * collectRemainingPages が読み切るページ数の上限（1ページ = pageSize件）。
 *
 * 通常の停止条件は「range で頼んだ範囲より少ない件数（＝空を含む）がDBから返ってきた
 * こと」だけであり、呼び出し元が range の from/to を付け忘れる・別のテーブルへ向いた
 * ままの fetchPage を渡す等のバグを踏むと、DBが毎回ちょうど pageSize件を返し続け
 * ループが終わらなくなる（呼び出し元が増えるほどこの種の実装ミスが起きやすい）。
 * TASKS_PAGE_SIZE(1000) × 50ページ = 5万件は通常のプロジェクト規模を大きく超えるため、
 * これに達した場合は正常系ではなく実装ミスとみなしてエラーにする。
 */
export const MAX_COLLECT_PAGES = 50

/**
 * tasks / meetings 共通の「続きのページを読み切る」ヘルパー。
 *
 * 1ページ目がちょうど pageSize 件だった場合のみ続きのページが存在しうるとみなし、
 * range を1ページずつずらしながら順番に取得する（waterfall。1ページ目が pageSize
 * 未満なら空間の全件を読み切れているので発生しない）。
 *
 * offsetページングは「順位」で境界を切るため、ページ取得の間に別の誰かが行を
 * 作成すると全行が1つずれ、あるページの最後の行が次ページの先頭にもう一度現れうる。
 * そのため最後に id で重複除去（先勝ち）してから返す。
 *
 * MAX_COLLECT_PAGES ページを読んでもなお続きがありそうな場合は、そこまでの結果を
 * 黙って打ち切って返す（＝古いものが黙って消える）のではなく、例外を投げる。
 * 呼び出し元は今のところ全て「例外時は前回の結果を保持する／1ページ目のみで続行する」
 * という既存の失敗時の扱いに乗るため、これは安全側の停止になる。
 */
export async function collectRemainingPages<T extends { id: string }>(
  firstPageRows: T[],
  // Supabase のクエリビルダは Promise ではなく PromiseLike（then を持つだけ）のため、
  // Promise<...> にすると tsc が型不一致で弾く。await は PromiseLike で十分動くので
  // 呼び出し側は fetchTasksPage / fetchMeetingsPage をそのまま渡せる。
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize: number
): Promise<T[]> {
  const allRows: T[] = [...firstPageRows]

  let page = 1
  while (allRows.length === page * pageSize) {
    if (page >= MAX_COLLECT_PAGES) {
      throw new Error(
        `collectRemainingPages: ページ数の上限(${MAX_COLLECT_PAGES}ページ、1ページ${pageSize}件)に達したため中断しました`
      )
    }
    const from = page * pageSize
    const to = from + pageSize - 1
    const pageResult = await fetchPage(from, to)
    if (pageResult.error) throw pageResult.error
    const rows = pageResult.data || []
    allRows.push(...rows)
    if (rows.length < pageSize) break
    page += 1
  }

  // ページ跨ぎの重複除去（id優先・先勝ち）
  const seenIds = new Set<string>()
  const dedupedRows: T[] = []
  for (const row of allRows) {
    if (seenIds.has(row.id)) continue
    seenIds.add(row.id)
    dedupedRows.push(row)
  }
  return dedupedRows
}

/** tasks テーブルから1ページ分（range指定）を取得する共通クエリ */
function fetchTasksPage(
  supabase: SupabaseClient,
  orgId: string,
  spaceId: string,
  from: number,
  to: number
) {
  return supabase
    .from('tasks')
    .select('*, task_owners (*)')
    .eq('org_id', orgId)
    .eq('space_id', spaceId)
    // created_at だけだと一括インポート等で同じ時刻のタスクが並び、ページ境界で
    // 行の見落とし・重複が起きうるため、id をタイブレークに使い並び順を安定させる。
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, to)
}

/**
 * Fetch tasks + owners + review statuses for a space.
 * tasks は空間の全件を range ページングで読み切る（TASKS_PAGE_SIZE を参照）。
 */
export async function fetchTasksQuery(
  supabase: SupabaseClient,
  orgId: string,
  spaceId: string
): Promise<TasksQueryData> {
  // Run tasks 1ページ目 + reviews を同じ Promise.all で並列に実行する
  const [tasksResult, reviewsResult] = await Promise.all([
    fetchTasksPage(supabase, orgId, spaceId, 0, TASKS_PAGE_SIZE - 1),
    supabase
      .from('reviews')
      .select('task_id, status')
      .eq('org_id', orgId)
      .eq('space_id', spaceId)
      .order('created_at', { ascending: false }),
  ])

  if (tasksResult.error) throw tasksResult.error

  if (reviewsResult.error) {
    console.warn('[fetchTasksQuery] reviews query failed:', reviewsResult.error.message)
  }

  const firstPageRows = (tasksResult.data || []) as Array<
    Record<string, unknown> & { id: string; task_owners?: unknown[] }
  >

  // 続きのページ取得＋ページ跨ぎの重複除去（id優先・先勝ち）は tasks / meetings 共通の
  // ヘルパーに委ねる。
  const rawTasks = await collectRemainingPages(
    firstPageRows,
    (from, to) => fetchTasksPage(supabase, orgId, spaceId, from, to),
    TASKS_PAGE_SIZE
  )

  const ownersByTask: Record<string, TaskOwner[]> = {}
  const cleanTasks: Task[] = rawTasks.map((t) => {
    const { task_owners, ...taskFields } = t
    if (Array.isArray(task_owners)) {
      ownersByTask[t.id] = task_owners as TaskOwner[]
    }
    return taskFields as unknown as Task
  })

  const reviewsByTask: Record<string, ReviewStatus> = {}
  if (Array.isArray(reviewsResult.data)) {
    // Results are ordered by created_at DESC — first occurrence per task_id is the latest
    for (const r of reviewsResult.data as Array<{ task_id: string; status: string }>) {
      if (!(r.task_id in reviewsByTask)) {
        reviewsByTask[r.task_id] = r.status as ReviewStatus
      }
    }
  }

  return { tasks: cleanTasks, owners: ownersByTask, reviewStatuses: reviewsByTask }
}

/**
 * Fetch milestones for a space.
 */
export async function fetchMilestonesQuery(
  supabase: SupabaseClient,
  spaceId: string
): Promise<Milestone[]> {
  const { data, error } = await supabase
    .from('milestones')
    .select('*')
    .eq('space_id', spaceId)
    .order('order_key', { ascending: true })

  if (error) throw error
  return (data || []) as Milestone[]
}

/** meetings テーブルから1ページ分（range指定）を取得する共通クエリ */
function fetchMeetingsPage(supabase: SupabaseClient, spaceId: string, from: number, to: number) {
  return supabase
    .from('meetings')
    .select(MEETING_LIST_COLUMNS)
    .eq('space_id', spaceId)
    // held_at だけだと同時刻登録で並び順が安定しないため、id をタイブレークに使う
    // （tasks の created_at + id と同じ考え方）。
    .order('held_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, to)
}

/**
 * Fetch meetings + participants for a space.
 * 以前は `.limit(50)` で最新50件のみを返しており、週次ミーティング等で会議数が
 * 51件を超えるプロジェクトでは古い会議が一覧から静かに消えていた。tasks と同じ
 * range ページング（TASKS_PAGE_SIZE / collectRemainingPages）で全件読み切る。
 */
export async function fetchMeetingsQuery(
  supabase: SupabaseClient,
  spaceId: string
): Promise<MeetingsQueryData> {
  const { data, error } = await fetchMeetingsPage(supabase, spaceId, 0, TASKS_PAGE_SIZE - 1)

  if (error) throw error

  const firstPageRows = (data || []) as Array<
    Record<string, unknown> & { id: string; meeting_participants?: unknown[] }
  >

  const rawMeetings = await collectRemainingPages(
    firstPageRows,
    (from, to) => fetchMeetingsPage(supabase, spaceId, from, to),
    TASKS_PAGE_SIZE
  )

  const participantsByMeeting: Record<string, MeetingParticipant[]> = {}
  const cleanMeetings: Meeting[] = rawMeetings.map((m) => {
    const { meeting_participants, ...meetingFields } = m
    if (Array.isArray(meeting_participants)) {
      participantsByMeeting[m.id] = meeting_participants as MeetingParticipant[]
    }
    return meetingFields as unknown as Meeting
  })

  return { meetings: cleanMeetings, participants: participantsByMeeting }
}

/**
 * プロジェクト1行の queryKey。クライアントの useSpaceRow と server 側の prefetch が
 * 同じキーを使うための正本（'use client' の無いこのファイルに置く）。
 */
export function spaceQueryKey(spaceId: string | null) {
  return ['space', spaceId] as const
}

/**
 * Fetch the space (project) row by ID.
 * 名前・アーカイブ状態・初期構成などは全て同じ1行なので、クライアント側の
 * useSpaceRow（queryKey: ['space', spaceId]）と同じ形で1回だけ取る。
 */
export async function fetchSpaceRowQuery(
  supabase: SupabaseClient,
  spaceId: string
): Promise<Record<string, unknown> | null> {
  // クライアントの useSpaceRow と同じく maybeSingle（行が無いのはエラーにしない）
  const { data, error } = await supabase
    .from('spaces')
    .select('*')
    .eq('id', spaceId)
    .maybeSingle()
  if (error) throw error
  return (data as Record<string, unknown> | null) ?? null
}
