'use client'

import { useRef, useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'
import { rpc } from '@/lib/supabase/rpc'
import { fireNotification } from '@/lib/slack/notify'
import { createAuditLog, generateAuditSummary } from '@/lib/audit'
import { getCachedUser, getCachedUserId } from '@/lib/supabase/cached-auth'
import { fetchTasksQuery } from '@/lib/supabase/queries'
import type { TasksQueryData, ReviewStatus } from '@/lib/supabase/queries'
import type {
  Task,
  TaskOwner,
  BallSide,
  TaskType,
  TaskStatus,
  DecisionState,
  ClientScope,
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
  clientScope?: ClientScope
  specPath?: string
  wikiPageId?: string
  decisionState?: DecisionState
  clientOwnerIds: string[]
  internalOwnerIds: string[]
  dueDate?: string
  assigneeId?: string
  milestoneId?: string
  parentTaskId?: string
}

export interface UpdateTaskInput {
  title?: string
  description?: string | null
  status?: TaskStatus
  priority?: number | null
  startDate?: string | null
  dueDate?: string | null
  assigneeId?: string | null
  milestoneId?: string | null
  parentTaskId?: string | null
  actualHours?: number | null
  wikiPageId?: string | null
}

// ReviewStatus and TasksQueryData are imported from @/lib/supabase/queries
export type { TasksQueryData }

interface UseTasksReturn {
  tasks: Task[]
  owners: Record<string, TaskOwner[]>
  reviewStatuses: Record<string, ReviewStatus>
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
  handleReviewChange: (taskId: string, status: string | null) => void
}

// TasksQueryData is imported from @/lib/supabase/queries

/**
 * Validate parent_task_id assignment for 1-level hierarchy constraint.
 * Throws if the assignment would violate nesting rules.
 */
function validateParentTask(
  parentTaskId: string | null | undefined,
  currentTaskId: string | undefined,
  tasks: Task[],
  spaceId: string
): void {
  if (!parentTaskId) return

  // Self-reference check
  if (currentTaskId && parentTaskId === currentTaskId) {
    throw new Error('タスクを自分自身の親に設定することはできません')
  }

  const parentTask = tasks.find((t) => t.id === parentTaskId)

  // Parent must exist in the current task list
  if (!parentTask) {
    // Parent may be in a different fetch — skip client-side check, DB trigger will catch it
    return
  }

  // Parent must be in the same space
  if (parentTask.space_id !== spaceId) {
    throw new Error('親タスクは同じスペース内である必要があります')
  }

  // Parent must not itself be a child (no deep nesting)
  if (parentTask.parent_task_id) {
    throw new Error('子タスクを親に設定することはできません（階層は1段階まで）')
  }

  // Current task must not already be a parent of other tasks
  if (currentTaskId) {
    const hasChildren = tasks.some((t) => t.parent_task_id === currentTaskId)
    if (hasChildren) {
      throw new Error('子タスクを持つタスクを別タスクの子にすることはできません')
    }
  }
}

export function useTasks({ orgId, spaceId }: UseTasksOptions): UseTasksReturn {
  const queryClient = useQueryClient()

  // Supabase client を useRef で安定化（遅延初期化で毎レンダー評価を回避）
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  const queryKey = ['tasks', orgId, spaceId] as const

  const { data, isPending, error: queryError } = useQuery<TasksQueryData>({
    queryKey,
    queryFn: () => fetchTasksQuery(supabase as SupabaseClient, orgId, spaceId),
    enabled: !!orgId && !!spaceId,
  })

  const tasks = useMemo(() => data?.tasks ?? [], [data?.tasks])
  const owners = useMemo(() => data?.owners ?? {}, [data?.owners])
  const reviewStatuses = useMemo(() => data?.reviewStatuses ?? {}, [data?.reviewStatuses])

  const fetchTasks = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['tasks', orgId, spaceId] })
  }, [queryClient, orgId, spaceId])

  const createTask = useCallback(
    async (task: CreateTaskInput) => {
      // Validate parent task assignment before proceeding
      validateParentTask(task.parentTaskId, undefined, tasks, spaceId)

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
        start_date: null,
        due_date: task.dueDate ?? null,
        milestone_id: task.milestoneId ?? null,
        parent_task_id: task.parentTaskId ?? null,
        actual_hours: null,
        completed_at: null,
        ball: task.ball,
        origin: task.origin,
        type: task.type,
        spec_path: task.type === 'spec' ? task.specPath ?? null : null,
        wiki_page_id: task.type === 'spec' ? task.wikiPageId ?? null : null,
        decision_state: task.type === 'spec' ? task.decisionState ?? null : null,
        client_scope: task.clientScope ?? 'internal',
        created_at: now,
        updated_at: now,
      }

      // Optimistic update
      queryClient.setQueryData<TasksQueryData>(['tasks', orgId, spaceId], (old) => ({
        tasks: [optimisticTask, ...(old?.tasks ?? [])],
        owners: old?.owners ?? {},
        reviewStatuses: old?.reviewStatuses ?? {},
      }))

      try {
        // Get authenticated user, or use demo user in development
        let userId: string
        const { user: authUser, error: authError } =
          await getCachedUser(supabase)

        if (authError || !authUser) {
          // Use demo user ID for development/testing
          const demoUserId = process.env.NEXT_PUBLIC_DEMO_USER_ID
          if (process.env.NODE_ENV === 'development' && demoUserId) {
            userId = demoUserId
          } else {
            throw new Error('ログインが必要です')
          }
        } else {
          userId = authUser.id
        }

        const insertData: Record<string, unknown> = {
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
              client_scope: task.clientScope ?? 'internal',
              due_date: task.dueDate ?? null,
              assignee_id: task.assigneeId ?? null,
              milestone_id: task.milestoneId ?? null,
              parent_task_id: task.parentTaskId ?? null,
              created_by: userId,
        }
        // wiki_page_id column may not exist yet (migration pending)
        const wikiPageId = task.type === 'spec' ? task.wikiPageId : undefined
        if (wikiPageId) {
          insertData.wiki_page_id = wikiPageId
        }

        const { data: created, error: createError } = await (supabase as SupabaseClient)
          .from('tasks')
          .insert(insertData)
          .select('*')
          .single()

        if (createError) throw createError

        const createdTask = created as Task

        // Replace optimistic task with real one
        queryClient.setQueryData<TasksQueryData>(['tasks', orgId, spaceId], (old) => ({
          tasks: (old?.tasks ?? []).map((t) => (t.id === tempId ? createdTask : t)),
          owners: old?.owners ?? {},
          reviewStatuses: old?.reviewStatuses ?? {},
        }))

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
          const { error: ownerError } = await (supabase as SupabaseClient)
            .from('task_owners')
            .insert(ownerRows as Record<string, unknown>[])
          if (ownerError) throw ownerError

          // owners をローカルcacheに反映（insertデータから構築）
          const ownerNow = new Date().toISOString()
          const localOwners: TaskOwner[] = ownerRows.map((row) => ({
            id: crypto.randomUUID(),
            org_id: row.org_id,
            space_id: row.space_id,
            task_id: row.task_id,
            side: row.side,
            user_id: row.user_id,
            created_at: ownerNow,
          }))
          queryClient.setQueryData<TasksQueryData>(['tasks', orgId, spaceId], (old) => ({
            tasks: old?.tasks ?? [],
            owners: { ...(old?.owners ?? {}), [createdTask.id]: localOwners },
            reviewStatuses: old?.reviewStatuses ?? {},
          }))
        }

        // Fire-and-forget Slack notification
        fireNotification({
          event: 'task_created',
          taskId: createdTask.id,
          spaceId,
        })

        // Fire-and-forget audit log
        void createAuditLog({
          supabase,
          orgId,
          spaceId,
          actorId: userId,
          actorRole: 'member',
          eventType: 'task.created',
          targetType: 'task',
          targetId: createdTask.id,
          summary: generateAuditSummary('task.created', { title: task.title }),
          dataAfter: {
            status: createdTask.status,
            milestone_id: createdTask.milestone_id,
          },
        })

        return createdTask
      } catch (err) {
        // Rollback: remove optimistic task
        queryClient.setQueryData<TasksQueryData>(['tasks', orgId, spaceId], (old) => ({
          tasks: (old?.tasks ?? []).filter((t) => t.id !== tempId),
          owners: old?.owners ?? {},
          reviewStatuses: old?.reviewStatuses ?? {},
        }))
        throw err
      }
    },
    [orgId, spaceId, supabase, tasks, queryClient]
  )

  const updateTask = useCallback(
    async (taskId: string, input: UpdateTaskInput): Promise<void> => {
      // Validate parent task assignment if being changed
      if (input.parentTaskId !== undefined) {
        validateParentTask(input.parentTaskId, taskId, tasks, spaceId)
      }

      // Capture previous state for rollback
      const previousData = queryClient.getQueryData<TasksQueryData>(['tasks', orgId, spaceId])
      const prevTask = previousData?.tasks.find((t) => t.id === taskId)

      // Optimistic update
      queryClient.setQueryData<TasksQueryData>(['tasks', orgId, spaceId], (old) => {
        if (!old) return { tasks: [], owners: {}, reviewStatuses: {} }
        return {
          tasks: old.tasks.map((t) => {
            if (t.id === taskId) {
              const newStatus = input.status ?? t.status
              return {
                ...t,
                title: input.title ?? t.title,
                description: input.description !== undefined ? input.description : t.description,
                status: newStatus,
                priority: input.priority !== undefined ? input.priority : t.priority,
                start_date: input.startDate !== undefined ? input.startDate : t.start_date,
                due_date: input.dueDate !== undefined ? input.dueDate : t.due_date,
                assignee_id: input.assigneeId !== undefined ? input.assigneeId : t.assignee_id,
                milestone_id: input.milestoneId !== undefined ? input.milestoneId : t.milestone_id,
                parent_task_id: input.parentTaskId !== undefined ? input.parentTaskId : t.parent_task_id,
                actual_hours: input.actualHours !== undefined ? input.actualHours : t.actual_hours,
                wiki_page_id: input.wikiPageId !== undefined ? input.wikiPageId : t.wiki_page_id,
                type: input.wikiPageId !== undefined ? (input.wikiPageId ? 'spec' : 'task') : t.type,
                decision_state: input.wikiPageId !== undefined
                  ? (input.wikiPageId ? (t.decision_state ?? 'considering') : null)
                  : t.decision_state,
                completed_at: newStatus === 'done' && t.status !== 'done'
                  ? new Date().toISOString()
                  : newStatus !== 'done' && t.status === 'done'
                    ? null
                    : t.completed_at,
                updated_at: new Date().toISOString(),
              }
            }
            return t
          }),
          owners: old.owners,
          reviewStatuses: old.reviewStatuses,
        }
      })

      try {
        const updateData: Record<string, unknown> = {}
        if (input.title !== undefined) updateData.title = input.title
        if (input.description !== undefined) updateData.description = input.description
        if (input.status !== undefined) updateData.status = input.status
        if (input.priority !== undefined) updateData.priority = input.priority
        if (input.startDate !== undefined) updateData.start_date = input.startDate
        if (input.dueDate !== undefined) updateData.due_date = input.dueDate
        if (input.assigneeId !== undefined) updateData.assignee_id = input.assigneeId
        if (input.milestoneId !== undefined) updateData.milestone_id = input.milestoneId
        if (input.parentTaskId !== undefined) updateData.parent_task_id = input.parentTaskId
        if (input.actualHours !== undefined) updateData.actual_hours = input.actualHours
        if (input.wikiPageId !== undefined) {
          updateData.wiki_page_id = input.wikiPageId
          updateData.type = input.wikiPageId ? 'spec' : 'task'
          if (input.wikiPageId) {
            // Set decision_state to 'considering' if not already set
            const currentTask = previousData?.tasks.find((t) => t.id === taskId)
            if (!currentTask?.decision_state) {
              updateData.decision_state = 'considering'
            }
          } else {
            updateData.decision_state = null
          }
        }

        const { error: updateError } = await (supabase as SupabaseClient)
          .from('tasks')
          .update(updateData)
          .eq('id', taskId)

        if (updateError) throw updateError

        // Fire-and-forget notification on status change
        if (input.status !== undefined && prevTask && prevTask.status !== input.status) {
          fireNotification({
            event: 'status_changed',
            taskId,
            spaceId,
            changes: {
              oldStatus: prevTask.status,
              newStatus: input.status,
            },
          })
        }

        // Fire-and-forget audit logs
        if (prevTask) {
          const actorId = (await getCachedUserId(supabase)) ?? 'unknown'

          // Status change audit log
          if (input.status !== undefined && prevTask.status !== input.status) {
            void createAuditLog({
              supabase,
              orgId,
              spaceId,
              actorId,
              actorRole: 'member',
              eventType: 'task.status_changed',
              targetType: 'task',
              targetId: taskId,
              summary: generateAuditSummary('task.status_changed', { title: prevTask.title }),
              dataBefore: {
                status: prevTask.status,
                milestone_id: prevTask.milestone_id,
              },
              dataAfter: {
                status: input.status,
                milestone_id: input.milestoneId !== undefined ? input.milestoneId : prevTask.milestone_id,
              },
            })
          }

          // Milestone completion audit log (fire-and-forget)
          if (input.status === 'done' && prevTask.status !== 'done' && prevTask.milestone_id) {
            void (async () => {
              try {
                const { data: msData } = await (supabase as SupabaseClient)
                  .from('milestones')
                  .select('id, name, completed_at')
                  .eq('id' as never, prevTask.milestone_id as never)
                  .single()
                if (msData?.completed_at) {
                  void createAuditLog({
                    supabase,
                    orgId,
                    spaceId,
                    actorId,
                    actorRole: 'member',
                    eventType: 'milestone.completed',
                    targetType: 'milestone',
                    targetId: msData.id,
                    summary: generateAuditSummary('milestone.completed', { name: msData.name }),
                    dataAfter: { completed_at: msData.completed_at },
                  })
                }
              } catch {
                // Best-effort: don't block task update on milestone audit failure
              }
            })()
          }

          // Milestone reassignment audit log
          if (input.milestoneId !== undefined && prevTask.milestone_id !== input.milestoneId) {
            void createAuditLog({
              supabase,
              orgId,
              spaceId,
              actorId,
              actorRole: 'member',
              eventType: 'task.updated',
              targetType: 'task',
              targetId: taskId,
              summary: generateAuditSummary('task.updated', { title: prevTask.title }),
              dataBefore: {
                milestone_id: prevTask.milestone_id,
              },
              dataAfter: {
                milestone_id: input.milestoneId,
              },
            })
          }
        }
      } catch (err) {
        // Targeted rollback — restore previous cache data
        if (previousData) {
          queryClient.setQueryData<TasksQueryData>(['tasks', orgId, spaceId], previousData)
        }
        throw err
      }
    },
    [supabase, orgId, spaceId, tasks, queryClient]
  )

  const deleteTask = useCallback(
    async (taskId: string): Promise<void> => {
      // Capture previous state for rollback
      const previousData = queryClient.getQueryData<TasksQueryData>(['tasks', orgId, spaceId])
      const removedTask = previousData?.tasks.find((t) => t.id === taskId)

      // Optimistic update
      queryClient.setQueryData<TasksQueryData>(['tasks', orgId, spaceId], (old) => {
        if (!old) return { tasks: [], owners: {}, reviewStatuses: {} }
        const nextOwners = { ...old.owners }
        delete nextOwners[taskId]
        const nextReviews = { ...old.reviewStatuses }
        delete nextReviews[taskId]
        return {
          tasks: old.tasks.filter((t) => t.id !== taskId),
          owners: nextOwners,
          reviewStatuses: nextReviews,
        }
      })

      try {
        const { error: deleteError } = await (supabase as SupabaseClient)
          .from('tasks')
          .delete()
          .eq('id', taskId)

        if (deleteError) throw deleteError

        // Fire-and-forget audit log
        if (removedTask) {
          const actorId = (await getCachedUserId(supabase)) ?? 'unknown'

          void createAuditLog({
            supabase,
            orgId,
            spaceId,
            actorId,
            actorRole: 'member',
            eventType: 'task.deleted',
            targetType: 'task',
            targetId: taskId,
            summary: generateAuditSummary('task.deleted', { title: removedTask.title }),
            dataBefore: {
              status: removedTask.status,
              milestone_id: removedTask.milestone_id,
            },
          })
        }
      } catch (err) {
        // Rollback — restore previous cache data
        if (previousData) {
          queryClient.setQueryData<TasksQueryData>(['tasks', orgId, spaceId], previousData)
        }
        throw err
      }
    },
    [supabase, orgId, spaceId, queryClient]
  )

  const passBall = useCallback(
    async (
      taskId: string,
      ball: BallSide,
      clientOwnerIds: string[],
      internalOwnerIds: string[]
    ) => {
      // Capture previous state for rollback
      const previousData = queryClient.getQueryData<TasksQueryData>(['tasks', orgId, spaceId])

      // Optimistic update
      queryClient.setQueryData<TasksQueryData>(['tasks', orgId, spaceId], (old) => {
        if (!old) return { tasks: [], owners: {}, reviewStatuses: {} }
        return {
          tasks: old.tasks.map((t) => (t.id === taskId ? { ...t, ball } : t)),
          owners: old.owners,
          reviewStatuses: old.reviewStatuses,
        }
      })

      try {
        await rpc.passBall(supabase, {
          taskId,
          ball,
          clientOwnerIds,
          internalOwnerIds,
        })

        // Fire-and-forget Slack notification
        fireNotification({
          event: 'ball_passed',
          taskId,
          spaceId,
          changes: { newBall: ball },
        })

        // owners を再取得（passBallでowners が変わるため）
        const { data: newOwners, error: ownerFetchError } = await (supabase as SupabaseClient)
          .from('task_owners')
          .select('*')
          .eq('task_id' as never, taskId as never)
        if (ownerFetchError) {
          // owner取得失敗時はフルリフレッシュにフォールバック
          await queryClient.invalidateQueries({ queryKey: ['tasks', orgId, spaceId] })
        } else if (newOwners) {
          queryClient.setQueryData<TasksQueryData>(['tasks', orgId, spaceId], (old) => {
            if (!old) return { tasks: [], owners: {}, reviewStatuses: {} }
            return {
              tasks: old.tasks,
              owners: { ...old.owners, [taskId]: newOwners as TaskOwner[] },
              reviewStatuses: old.reviewStatuses,
            }
          })
        }
      } catch (err) {
        // エラー時はキャッシュを復元してから再フェッチ
        if (previousData) {
          queryClient.setQueryData<TasksQueryData>(['tasks', orgId, spaceId], previousData)
        }
        await queryClient.invalidateQueries({ queryKey: ['tasks', orgId, spaceId] })
        throw err
      }
    },
    [supabase, queryClient, orgId, spaceId]
  )

  // Optimistic update for review status badge
  const handleReviewChange = useCallback((taskId: string, status: string | null) => {
    queryClient.setQueryData<TasksQueryData>(['tasks', orgId, spaceId], (old) => {
      if (!old) return { tasks: [], owners: {}, reviewStatuses: {} }
      const nextReviews = { ...old.reviewStatuses }
      if (!status) {
        delete nextReviews[taskId]
      } else {
        nextReviews[taskId] = status as ReviewStatus
      }
      return {
        tasks: old.tasks,
        owners: old.owners,
        reviewStatuses: nextReviews,
      }
    })
  }, [queryClient, orgId, spaceId])

  return {
    tasks,
    owners,
    reviewStatuses,
    loading: isPending && !data,
    error: queryError,
    fetchTasks,
    createTask,
    updateTask,
    deleteTask,
    passBall,
    handleReviewChange,
  }
}
