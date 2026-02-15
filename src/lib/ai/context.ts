import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let _supabaseAdmin: ReturnType<typeof createClient> | null = null
function getSupabaseAdmin() {
  if (!_supabaseAdmin) {
    _supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _supabaseAdmin
}

export interface SlackMentionContext {
  spaceName: string
  recentTasks: Array<{
    id: string
    title: string
    status: string
    ball: string
    assigneeName?: string
    dueDate?: string
  }>
  memberNames: string[]
}

/**
 * Build context for LLM from the current space.
 *
 * Fetches space name, recent tasks (with assignee names), and member names
 * to provide the LLM with project context for answering questions.
 */
export async function buildMentionContext(
  spaceId: string,
  orgId: string,
): Promise<SlackMentionContext> {
  // Fetch space, tasks, and memberships in parallel
  const [spaceResult, tasksResult, membershipsResult] = await Promise.all([
    (getSupabaseAdmin() as SupabaseClient)
      .from('spaces')
      .select('name')
      .eq('id', spaceId)
      .eq('org_id', orgId)
      .single(),

    (getSupabaseAdmin() as SupabaseClient)
      .from('tasks')
      .select('id, title, status, ball, assignee_id, due_date')
      .eq('space_id', spaceId)
      .eq('org_id', orgId)
      .order('updated_at', { ascending: false })
      .limit(20),

    (getSupabaseAdmin() as SupabaseClient)
      .from('space_memberships')
      .select('user_id')
      .eq('space_id', spaceId),
  ])

  const spaceName = spaceResult.data?.name ?? 'Unknown'
  const tasks = tasksResult.data ?? []
  const memberships = membershipsResult.data ?? []

  // Collect unique user IDs (assignees + members)
  const assigneeIds = tasks
    .map((t: { assignee_id: string | null }) => t.assignee_id)
    .filter((id: string | null): id is string => !!id)
  const memberUserIds = memberships.map((m: { user_id: string }) => m.user_id)
  const allUserIds = Array.from(new Set([...assigneeIds, ...memberUserIds]))

  // Fetch all profile names in one query
  const profileMap = new Map<string, string>()
  if (allUserIds.length > 0) {
    const { data: profiles } = await (getSupabaseAdmin() as SupabaseClient)
      .from('profiles')
      .select('id, display_name')
      .in('id', allUserIds)

    for (const p of profiles ?? []) {
      if (p.display_name) {
        profileMap.set(p.id, p.display_name)
      }
    }
  }

  // Build task list with assignee names
  const recentTasks = tasks.map(
    (t: { id: string; title: string; status: string; ball: string; assignee_id: string | null; due_date: string | null }) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      ball: t.ball,
      assigneeName: t.assignee_id ? profileMap.get(t.assignee_id) : undefined,
      dueDate: t.due_date ?? undefined,
    }),
  )

  // Build member name list
  const memberNames = memberUserIds
    .map((uid: string) => profileMap.get(uid))
    .filter((name: string | undefined): name is string => !!name)

  return { spaceName, recentTasks, memberNames }
}
