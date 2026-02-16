import { QueryClient } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Task, Milestone } from '@/types/database'

type TaskOwner = { id: string; task_id: string; user_id: string; role: string }
type ReviewStatus = string

interface TasksQueryData {
  tasks: Task[]
  owners: Record<string, TaskOwner[]>
  reviewStatuses: Record<string, ReviewStatus>
}

/**
 * Prefetch tasks + owners + reviewStatuses for a space.
 * Must match queryKey/data shape of useTasks hook exactly.
 */
export async function prefetchTasks(
  queryClient: QueryClient,
  supabase: SupabaseClient,
  orgId: string,
  spaceId: string
) {
  await queryClient.prefetchQuery<TasksQueryData>({
    queryKey: ['tasks', orgId, spaceId],
    queryFn: async () => {
      const { data: tasksData, error: tasksError } = await supabase
        .from('tasks')
        .select('*, task_owners (*)')
        .eq('org_id', orgId)
        .eq('space_id', spaceId)
        .order('created_at', { ascending: false })
        .limit(50)

      if (tasksError) throw tasksError

      const { data: reviewsData } = await supabase
        .from('reviews')
        .select('task_id, status')
        .eq('space_id', spaceId)

      const rawTasks = (tasksData || []) as Array<Record<string, unknown> & { id: string; task_owners?: unknown[] }>
      const ownersByTask: Record<string, TaskOwner[]> = {}
      const cleanTasks: Task[] = rawTasks.map((t) => {
        const { task_owners, ...taskFields } = t
        if (Array.isArray(task_owners)) {
          ownersByTask[t.id] = task_owners as TaskOwner[]
        }
        return taskFields as unknown as Task
      })

      const reviewsByTask: Record<string, ReviewStatus> = {}
      if (Array.isArray(reviewsData)) {
        for (const r of reviewsData as Array<{ task_id: string; status: string }>) {
          reviewsByTask[r.task_id] = r.status as ReviewStatus
        }
      }

      return { tasks: cleanTasks, owners: ownersByTask, reviewStatuses: reviewsByTask }
    },
  })
}

/**
 * Prefetch milestones for a space.
 * Must match queryKey/data shape of useMilestones hook exactly.
 */
export async function prefetchMilestones(
  queryClient: QueryClient,
  supabase: SupabaseClient,
  spaceId: string
) {
  await queryClient.prefetchQuery<Milestone[]>({
    queryKey: ['milestones', spaceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('milestones')
        .select('*')
        .eq('space_id', spaceId)
        .order('order_key', { ascending: true })

      if (error) throw error
      return (data || []) as Milestone[]
    },
  })
}

/**
 * Prefetch space name.
 */
export async function prefetchSpaceName(
  queryClient: QueryClient,
  supabase: SupabaseClient,
  spaceId: string
) {
  await queryClient.prefetchQuery<string>({
    queryKey: ['spaceName', spaceId],
    queryFn: async () => {
      const { data } = await supabase
        .from('spaces')
        .select('name')
        .eq('id', spaceId)
        .single()
      return (data as { name: string } | null)?.name ?? ''
    },
  })
}
