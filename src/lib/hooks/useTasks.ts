'use client'

import { useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { rpc } from '@/lib/supabase/rpc'
import { fireNotification } from '@/lib/slack/notify'
import { createAuditLog, generateAuditSummary } from '@/lib/audit'
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
  startDate?: string | null
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

  // Supabase client を useRef で安定化（遅延初期化で毎レンダー評価を回避）
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (!supabaseRef.current) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  // フェッチのレース条件対策用カウンター
  const fetchIdRef = useRef(0)

  const fetchTasks = useCallback(async () => {
    const currentFetchId = ++fetchIdRef.current
    setLoading(true)
    setError(null)

    try {
      // 1クエリで tasks + task_owners を取得（ネストselect）
      const { data: tasksData, error: tasksError } = await supabase
        .from('tasks')
        .select('*, task_owners (*)')
        .eq('org_id' as never, orgId as never)
        .eq('space_id' as never, spaceId as never)
        .order('created_at', { ascending: false })
        .limit(50)

      if (tasksError) throw tasksError

      // レース条件: 古いリクエストの結果を無視
      if (currentFetchId !== fetchIdRef.current) return

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawTasks = (tasksData || []) as any[]

      // task_owners をグルーピングし、tasks からは除去
      const ownersByTask: Record<string, TaskOwner[]> = {}
      const cleanTasks: Task[] = rawTasks.map((t) => {
        const { task_owners, ...taskFields } = t
        if (Array.isArray(task_owners)) {
          ownersByTask[t.id] = task_owners as TaskOwner[]
        }
        return taskFields as Task
      })

      setTasks(cleanTasks)
      setOwners(ownersByTask)
    } catch (err) {
      if (currentFetchId !== fetchIdRef.current) return
      setError(err instanceof Error ? err : new Error('Failed to fetch tasks'))
    } finally {
      if (currentFetchId === fetchIdRef.current) {
        setLoading(false)
      }
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
        client_scope: task.clientScope ?? 'internal',
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
              client_scope: task.clientScope ?? 'internal',
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

          // owners をローカルstate に反映（insertデータから構築）
          const now = new Date().toISOString()
          const localOwners: TaskOwner[] = ownerRows.map((row) => ({
            id: crypto.randomUUID(),
            org_id: row.org_id,
            space_id: row.space_id,
            task_id: row.task_id,
            side: row.side,
            user_id: row.user_id,
            created_at: now,
          }))
          setOwners((prev) => ({
            ...prev,
            [createdTask.id]: localOwners,
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
        setTasks((prev) => prev.filter((t) => t.id !== tempId))
        setError(
          err instanceof Error ? err : new Error('Failed to create task')
        )
        throw err
      }
    },
    [orgId, spaceId, supabase]
  )

  const updateTask = useCallback(
    async (taskId: string, input: UpdateTaskInput): Promise<void> => {
      // Capture only the specific task for targeted rollback (avoids stale closure)
      let prevTask: Task | undefined

      // Optimistic update
      setTasks((prev) =>
        prev.map((t) => {
          if (t.id === taskId) {
            prevTask = t
            return {
              ...t,
              title: input.title ?? t.title,
              description: input.description !== undefined ? input.description : t.description,
              status: input.status ?? t.status,
              priority: input.priority !== undefined ? input.priority : t.priority,
              start_date: input.startDate !== undefined ? input.startDate : t.start_date,
              due_date: input.dueDate !== undefined ? input.dueDate : t.due_date,
              assignee_id: input.assigneeId !== undefined ? input.assigneeId : t.assignee_id,
              milestone_id: input.milestoneId !== undefined ? input.milestoneId : t.milestone_id,
              updated_at: new Date().toISOString(),
            }
          }
          return t
        })
      )

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

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: updateError } = await (supabase as any)
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
          const { data: authData } = await supabase.auth.getUser()
          const actorId = authData?.user?.id ?? 'unknown'

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
        // Targeted rollback — only revert the specific task, preserving other concurrent mutations
        if (prevTask) {
          setTasks((prev) => prev.map((t) => (t.id === taskId ? prevTask! : t)))
        }
        setError(err instanceof Error ? err : new Error('Failed to update task'))
        throw err
      }
    },
    [supabase, orgId, spaceId]
  )

  const deleteTask = useCallback(
    async (taskId: string): Promise<void> => {
      // Capture specific item for targeted rollback (avoids stale closure)
      let removedTask: Task | undefined
      let removedIndex = -1
      let removedOwners: TaskOwner[] | undefined

      // Optimistic update
      setTasks((prev) => {
        removedIndex = prev.findIndex((t) => t.id === taskId)
        if (removedIndex !== -1) removedTask = prev[removedIndex]
        return prev.filter((t) => t.id !== taskId)
      })
      setOwners((prev) => {
        removedOwners = prev[taskId]
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

        // Fire-and-forget audit log
        if (removedTask) {
          const { data: authData } = await supabase.auth.getUser()
          const actorId = authData?.user?.id ?? 'unknown'

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
        // Targeted rollback — re-insert at original position, preserving other concurrent mutations
        if (removedTask) {
          setTasks((prev) => {
            const next = [...prev]
            next.splice(removedIndex, 0, removedTask!)
            return next
          })
        }
        if (removedOwners) {
          setOwners((prev) => ({ ...prev, [taskId]: removedOwners! }))
        }
        setError(err instanceof Error ? err : new Error('Failed to delete task'))
        throw err
      }
    },
    [supabase, orgId, spaceId]
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

        // Fire-and-forget Slack notification
        fireNotification({
          event: 'ball_passed',
          taskId,
          spaceId,
          changes: { newBall: ball },
        })

        // owners を再取得（passBallでowners が変わるため）
        const { data: newOwners, error: ownerFetchError } = await supabase
          .from('task_owners')
          .select('*')
          .eq('task_id' as never, taskId as never)
        if (ownerFetchError) {
          // owner取得失敗時はフルリフレッシュにフォールバック
          await fetchTasks()
        } else if (newOwners) {
          setOwners((prev) => ({ ...prev, [taskId]: newOwners as TaskOwner[] }))
        }
      } catch (err) {
        // エラー時のみ全件再取得
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
