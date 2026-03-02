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

export type ReviewStatus = 'open' | 'approved' | 'changes_requested'

export interface TasksQueryData {
  tasks: Task[]
  owners: Record<string, TaskOwner[]>
  reviewStatuses: Record<string, ReviewStatus>
}

export interface MeetingsQueryData {
  meetings: Meeting[]
  participants: Record<string, MeetingParticipant[]>
}

/** Meeting list columns (excludes minutes_md to reduce transfer size) */
export const MEETING_LIST_COLUMNS = `
  id, org_id, space_id, title, held_at, notes, status,
  started_at, ended_at, summary_subject, summary_body,
  created_at, updated_at,
  meeting_participants (*)
` as const

// ── Shared query functions ──

/**
 * Fetch tasks + owners + review statuses for a space.
 */
export async function fetchTasksQuery(
  supabase: SupabaseClient,
  orgId: string,
  spaceId: string
): Promise<TasksQueryData> {
  // Run tasks + reviews in parallel (independent queries)
  const [tasksResult, reviewsResult] = await Promise.all([
    supabase
      .from('tasks')
      .select('*, task_owners (*)')
      .eq('org_id', orgId)
      .eq('space_id', spaceId)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('reviews')
      .select('task_id, status')
      .eq('space_id', spaceId),
  ])

  if (tasksResult.error) throw tasksResult.error

  if (reviewsResult.error) {
    console.warn('[fetchTasksQuery] reviews query failed:', reviewsResult.error.message)
  }

  const rawTasks = (tasksResult.data || []) as Array<
    Record<string, unknown> & { id: string; task_owners?: unknown[] }
  >
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
    for (const r of reviewsResult.data as Array<{ task_id: string; status: string }>) {
      reviewsByTask[r.task_id] = r.status as ReviewStatus
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

/**
 * Fetch meetings + participants for a space.
 */
export async function fetchMeetingsQuery(
  supabase: SupabaseClient,
  spaceId: string
): Promise<MeetingsQueryData> {
  const { data, error } = await supabase
    .from('meetings')
    .select(MEETING_LIST_COLUMNS)
    .eq('space_id', spaceId)
    .order('held_at', { ascending: false })
    .limit(50)

  if (error) throw error

  const rawMeetings = (data || []) as Array<
    Record<string, unknown> & { id: string; meeting_participants?: unknown[] }
  >
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
 * Fetch space name by ID.
 */
export async function fetchSpaceNameQuery(
  supabase: SupabaseClient,
  spaceId: string
): Promise<string> {
  const { data } = await supabase
    .from('spaces')
    .select('name')
    .eq('id', spaceId)
    .single()
  return (data as { name: string } | null)?.name ?? ''
}
