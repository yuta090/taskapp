import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PortalTaskDetailClient } from './PortalTaskDetailClient'

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

  // Get task details
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: task, error } = await (supabase as any)
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
      spaces!inner (
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
    .single()

  if (error || !task) {
    notFound()
  }

  // Verify user has client access to this task's space
  // Note: Return notFound() instead of redirect to prevent task ID probing
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: membership } = await (supabase as any)
    .from('space_memberships')
    .select('id, role')
    .eq('space_id', task.space_id)
    .eq('user_id', user.id)
    .eq('role', 'client')
    .single()

  if (!membership) {
    notFound()
  }

  // Get task comments (client-visible only)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: comments } = await (supabase as any)
    .from('task_comments')
    .select(`
      id,
      body,
      created_at,
      actor_id,
      profiles!task_comments_actor_id_fkey (
        id,
        display_name
      )
    `)
    .eq('task_id', taskId)
    .eq('visibility', 'client')
    .is('deleted_at', null)
    .order('created_at', { ascending: true })

  // Get client's other projects for the header
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: memberships } = await (supabase as any)
    .from('space_memberships')
    .select(`
      space_id,
      spaces!inner (
        id,
        name,
        org_id,
        organizations!inner (
          id,
          name
        )
      )
    `)
    .eq('user_id', user.id)
    .eq('role', 'client')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const projects = (memberships || []).map((m: any) => ({
    id: m.space_id,
    name: m.spaces?.name || 'プロジェクト',
    orgId: m.spaces?.org_id,
    orgName: m.spaces?.organizations?.name || '組織',
  }))

  const currentProject = projects.find((p: { id: string }) => p.id === task.space_id) || projects[0]

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
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const formattedComments = (comments || []).map((c: any) => ({
    id: c.id,
    content: c.body,
    createdAt: c.created_at,
    author: c.profiles?.display_name || 'Unknown',
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
