'use client'

import { useState, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { rpc } from '@/lib/supabase/rpc'
import type {
  Task,
  TaskOwner,
  BallSide,
  TaskType,
  TaskStatus,
  DecisionState,
} from '@/types/database'

interface UseTasksOptions {
  orgId: string
  spaceId: string
}

export interface CreateTaskInput {
  title: string
  description?: string
  type: TaskType
  ball: BallSide
  origin: BallSide
  specPath?: string
  decisionState?: DecisionState
  clientOwnerIds: string[]
  internalOwnerIds: string[]
  dueDate?: string
  assigneeId?: string
  milestoneId?: string
}

export interface UpdateTaskInput {
  title?: string
  description?: string | null
  status?: TaskStatus
  priority?: number | null
  startDate?: string | null  // Note: requires start_date column in DB (future migration)
  dueDate?: string | null
  assigneeId?: string | null
  milestoneId?: string | null
}

interface UseTasksReturn {
  tasks: Task[]
  owners: Record<string, TaskOwner[]>
  loading: boolean
  error: Error | null
  fetchTasks: () => Promise<void>
  createTask: (task: CreateTaskInput) => Promise<Task>
  updateTask: (taskId: string, input: UpdateTaskInput) => Promise<void>
  deleteTask: (taskId: string) => Promise<void>
  passBall: (
    taskId: string,
    ball: BallSide,
    clientOwnerIds: string[],
    internalOwnerIds: string[]
  ) => Promise<void>
}

export function useTasks({ orgId, spaceId }: UseTasksOptions): UseTasksReturn {
  const [tasks, setTasks] = useState<Task[]>([])
  const [owners, setOwners] = useState<Record<string, TaskOwner[]>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  // Memoize supabase client to prevent recreating on every render
  const supabase = useMemo(() => createClient(), [])

  const fetchTasks = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      // Fetch tasks with org_id scope to prevent cross-org data leak
      const { data: tasksData, error: tasksError } = await supabase
        .from('tasks')
        .select('*')
        .eq('org_id' as never, orgId as never)
        .eq('space_id' as never, spaceId as never)
        .order('created_at', { ascending: false })

      if (tasksError) throw tasksError
      const tasksList = (tasksData || []) as Task[]
      setTasks(tasksList)

      // Fetch owners for all tasks with org_id scope
      const taskIds = tasksList.map((t) => t.id)
      if (taskIds.length > 0) {
        const { data: ownersData, error: ownersError } = await supabase
          .from('task_owners')
          .select('*')
          .eq('org_id' as never, orgId as never)
          .in('task_id' as never, taskIds as never)

        if (ownersError) throw ownersError

        // Group owners by task_id
        const ownersByTask: Record<string, TaskOwner[]> = {}
        const ownersList = (ownersData || []) as TaskOwner[]
        ownersList.forEach((owner) => {
          if (!ownersByTask[owner.task_id]) {
            ownersByTask[owner.task_id] = []
          }
          ownersByTask[owner.task_id].push(owner)
        })
        setOwners(ownersByTask)
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch tasks'))
    } finally {
      setLoading(false)
    }
  }, [orgId, spaceId, supabase])

  const createTask = useCallback(
    async (task: CreateTaskInput) => {
      const now = new Date().toISOString()
      const tempId = crypto.randomUUID()
      const status = task.type === 'spec' ? 'considering' : 'backlog'
      const optimisticTask: Task = {
        id: tempId,
        org_id: orgId,
        space_id: spaceId,
        title: task.title,
        description: task.description ?? '',
        status,
        priority: null,
        assignee_id: task.assigneeId ?? null,
        due_date: task.dueDate ?? null,
        milestone_id: task.milestoneId ?? null,
        ball: task.ball,
        origin: task.origin,
        type: task.type,
        spec_path: task.type === 'spec' ? task.specPath ?? null : null,
        decision_state: task.type === 'spec' ? task.decisionState ?? null : null,
        created_at: now,
        updated_at: now,
      }

      setTasks((prev) => [optimisticTask, ...prev])

      try {
        // Get authenticated user, or use demo user in development
        let userId: string
        const { data: authData, error: authError } =
          await supabase.auth.getUser()

        if (authError || !authData?.user) {
          // Use demo user ID for development/testing
          const demoUserId = process.env.NEXT_PUBLIC_DEMO_USER_ID
          if (process.env.NODE_ENV === 'development' && demoUserId) {
            userId = demoUserId
          } else {
            throw new Error('ログインが必要です')
          }
        } else {
          userId = authData.user.id
        }

        const { data: created, error: createError } = await supabase
          .from('tasks')
          .insert(
            {
              org_id: orgId,
              space_id: spaceId,
              title: task.title,
              description: task.description ?? '',
              status,
              ball: task.ball,
              origin: task.origin,
              type: task.type,
              spec_path: task.type === 'spec' ? task.specPath ?? null : null,
              decision_state:
                task.type === 'spec' ? task.decisionState ?? null : null,
              due_date: task.dueDate ?? null,
              assignee_id: task.assigneeId ?? null,
              milestone_id: task.milestoneId ?? null,
              created_by: userId,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any
          )
          .select('*')
          .single()

        if (createError) throw createError

        const createdTask = created as Task

        setTasks((prev) =>
          prev.map((t) => (t.id === tempId ? createdTask : t))
        )

        const ownerRows = [
          ...task.clientOwnerIds.map((ownerId) => ({
            org_id: orgId,
            space_id: spaceId,
            task_id: createdTask.id,
            side: 'client' as const,
            user_id: ownerId,
          })),
          ...task.internalOwnerIds.map((ownerId) => ({
            org_id: orgId,
            space_id: spaceId,
            task_id: createdTask.id,
            side: 'internal' as const,
            user_id: ownerId,
          })),
        ]

        if (ownerRows.length > 0) {
          const { error: ownerError } = await supabase
            .from('task_owners')
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .insert(ownerRows as any)
          if (ownerError) throw ownerError
        }

        await fetchTasks()
        return createdTask
      } catch (err) {
        setTasks((prev) => prev.filter((t) => t.id !== tempId))
        setError(
          err instanceof Error ? err : new Error('Failed to create task')
        )
        throw err
      }
    },
    [orgId, spaceId, supabase, fetchTasks]
  )

  const updateTask = useCallback(
    async (taskId: string, input: UpdateTaskInput): Promise<void> => {
      // Store previous state for rollback
      const prevTasks = tasks

      // Optimistic update
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? {
                ...t,
                title: input.title ?? t.title,
                description: input.description !== undefined ? input.description : t.description,
                status: input.status ?? t.status,
                priority: input.priority !== undefined ? input.priority : t.priority,
                due_date: input.dueDate !== undefined ? input.dueDate : t.due_date,
                assignee_id: input.assigneeId !== undefined ? input.assigneeId : t.assignee_id,
                milestone_id: input.milestoneId !== undefined ? input.milestoneId : t.milestone_id,
                updated_at: new Date().toISOString(),
              }
            : t
        )
      )

      try {
        const updateData: Record<string, unknown> = {}
        if (input.title !== undefined) updateData.title = input.title
        if (input.description !== undefined) updateData.description = input.description
        if (input.status !== undefined) updateData.status = input.status
        if (input.priority !== undefined) updateData.priority = input.priority
        if (input.dueDate !== undefined) updateData.due_date = input.dueDate
        if (input.assigneeId !== undefined) updateData.assignee_id = input.assigneeId
        if (input.milestoneId !== undefined) updateData.milestone_id = input.milestoneId

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: updateError } = await (supabase as any)
          .from('tasks')
          .update(updateData)
          .eq('id', taskId)

        if (updateError) throw updateError
      } catch (err) {
        // Revert optimistic update
        setTasks(prevTasks)
        setError(err instanceof Error ? err : new Error('Failed to update task'))
        throw err
      }
    },
    [tasks, supabase]
  )

  const deleteTask = useCallback(
    async (taskId: string): Promise<void> => {
      // Store previous state for rollback
      const prevTasks = tasks
      const prevOwners = owners

      // Optimistic update
      setTasks((prev) => prev.filter((t) => t.id !== taskId))
      setOwners((prev) => {
        const next = { ...prev }
        delete next[taskId]
        return next
      })

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: deleteError } = await (supabase as any)
          .from('tasks')
          .delete()
          .eq('id', taskId)

        if (deleteError) throw deleteError
      } catch (err) {
        // Revert optimistic update
        setTasks(prevTasks)
        setOwners(prevOwners)
        setError(err instanceof Error ? err : new Error('Failed to delete task'))
        throw err
      }
    },
    [tasks, owners, supabase]
  )

  const passBall = useCallback(
    async (
      taskId: string,
      ball: BallSide,
      clientOwnerIds: string[],
      internalOwnerIds: string[]
    ) => {
      // Optimistic update
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, ball } : t))
      )

      try {
        await rpc.passBall(supabase, {
          taskId,
          ball,
          clientOwnerIds,
          internalOwnerIds,
        })
        // Refetch to get updated owners
        await fetchTasks()
      } catch (err) {
        // Revert on error
        await fetchTasks()
        throw err
      }
    },
    [supabase, fetchTasks]
  )

  return {
    tasks,
    owners,
    loading,
    error,
    fetchTasks,
    createTask,
    updateTask,
    deleteTask,
    passBall,
  }
}
