import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PortalTaskDetailClient } from './PortalTaskDetailClient'
import { getClientProjects } from '@/lib/portal/getClientProjects'
import { UNKNOWN_PROFILE_LABEL } from '@/lib/labels'
import type { SupabaseClient } from '@supabase/supabase-js'

interface PageProps {
  params: Promise<{ taskId: string }>
}

export default async function PortalTaskDetailPage({ params }: PageProps) {
  const { taskId } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Task details, comments, and the client's other projects don't depend on
  // each other's results, so read them together instead of one-by-one.
  const [
    { data: task, error },
    { data: comments },
    projects,
  ] = await Promise.all([
    // Get task details

    (supabase as SupabaseClient)
      .from('tasks')
      .select(`
        id,
        title,
        description,
        status,
        ball,
        type,
        due_date,
        spec_path,
        decision_state,
        created_at,
        updated_at,
        space_id,
        estimated_cost,
        estimate_status,
        spaces!tasks_space_id_fkey!inner (
          id,
          name,
          org_id,
          organizations!inner (
            id,
            name
          )
        )
      `)
      .eq('id', taskId)
      .single(),

    // Get task comments (client-visible only)

    (supabase as SupabaseClient)
      .from('task_comments')
      .select(`
        id,
        body,
        created_at,
        actor_id
      `)
      .eq('task_id', taskId)
      .eq('visibility', 'client')
      .is('deleted_at', null)
      .order('created_at', { ascending: true }),

    // Get client's other projects for the header. currentProject always
    // follows the task's own space (not ?space=) — this page shows one
    // specific task, so switching "current project" here means navigating
    // to that project's portal home, not re-rendering this task under a
    // different project.
    getClientProjects(supabase as SupabaseClient, user.id),
  ])

  if (error || !task) {
    notFound()
  }

  // task_comments→profilesの外部キーは無いため埋め込みは使えず、書き手の表示名は
  // 別問い合わせでまとめて引く。見えるかの確認(membership)とは互いに依存しないので
  // 並べて読む
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const commentActorIds = [...new Set(((comments || []) as any[]).map((c) => c.actor_id).filter((id): id is string => !!id))]

  const [{ data: membership }, { data: commentProfiles }] = await Promise.all([
    // Verify user has client access to this task's space
    // Note: Return notFound() instead of redirect to prevent task ID probing
    (supabase as SupabaseClient)
      .from('space_memberships')
      .select('id, role')
      .eq('space_id', task.space_id)
      .eq('user_id', user.id)
      .eq('role', 'client')
      .single(),
    commentActorIds.length > 0
      ? (supabase as SupabaseClient).from('profiles').select('id, display_name').in('id', commentActorIds)
      : Promise.resolve({ data: [] as { id: string; display_name: string | null }[] }),
  ])

  if (!membership) {
    notFound()
  }

  const profileNameByActorId = new Map<string, string | null>(
    (commentProfiles || []).map((p) => [p.id, p.display_name]),
  )

  const currentProject = projects.find((p) => p.id === task.space_id) || projects[0]

  const now = new Date()
  const createdAt = new Date(task.created_at)
  const waitingDays = Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24))
  const isOverdue = task.due_date ? new Date(task.due_date) < now : false

  const taskDetails = {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    ball: task.ball,
    type: task.type as 'task' | 'spec',
    dueDate: task.due_date,
    specPath: task.spec_path,
    decisionState: task.decision_state,
    createdAt: task.created_at,
    updatedAt: task.updated_at,
    waitingDays,
    isOverdue,
    estimatedCost: task.estimated_cost as number | null,
    estimateStatus: (task.estimate_status || 'none') as 'none' | 'pending' | 'approved' | 'rejected',
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const formattedComments = (comments || []).map((c: any) => ({
    id: c.id,
    content: c.body,
    createdAt: c.created_at,
    author: (c.actor_id && profileNameByActorId.get(c.actor_id)) || UNKNOWN_PROFILE_LABEL,
  }))

  return (
    <PortalTaskDetailClient
      currentProject={currentProject}
      projects={projects}
      task={taskDetails}
      comments={formattedComments}
    />
  )
}
