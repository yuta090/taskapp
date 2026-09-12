'use client'

import { useRef, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchMilestonesQuery } from '@/lib/supabase/queries'
import type { TasksQueryData } from '@/lib/supabase/queries'
import type { Milestone } from '@/types/database'

interface UseMilestonesOptions {
  spaceId: string
}

interface CreateMilestoneInput {
  name: string
  startDate?: string | null
  dueDate?: string | null
}

interface UpdateMilestoneInput {
  name?: string
  startDate?: string | null
  dueDate?: string | null
  orderKey?: number
}

interface UseMilestonesReturn {
  milestones: Milestone[]
  loading: boolean
  error: Error | null
  /**
   * 一度も取得できていないまま失敗した場合だけ true（react-query の isLoadingError）。
   * 前回分のデータがある状態で裏の取り直しだけ失敗した場合は false のままなので、
   * 呼び出し側はこのフラグでエラー画面に切り替えるかどうかを判断する
   * （useCanEditSpace と同じ考え方: isError は背後の再取得失敗でも true のまま残るため使わない）
   */
  isLoadingError: boolean
  fetchMilestones: () => Promise<void>
  createMilestone: (input: CreateMilestoneInput) => Promise<Milestone>
  updateMilestone: (id: string, input: UpdateMilestoneInput) => Promise<void>
  deleteMilestone: (id: string) => Promise<void>
}

// 読み込み中に毎レンダー新しい [] を返すと、呼び出し側の useMemo/useEffect の依存が毎回変わり
// （effect → setState → 再レンダー → また新しい配列）無限ループになるため共有定数にする
const EMPTY_MILESTONES: Milestone[] = []

export function useMilestones({ spaceId }: UseMilestonesOptions): UseMilestonesReturn {
  const queryClient = useQueryClient()

  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  const queryKey = ['milestones', spaceId] as const

  const { data, isPending, isLoadingError, error: queryError } = useQuery<Milestone[]>({
    queryKey,
    queryFn: () => fetchMilestonesQuery(supabase as SupabaseClient, spaceId),
    enabled: !!spaceId,
  })

  const milestones = data ?? EMPTY_MILESTONES

  const fetchMilestones = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['milestones', spaceId] })
  }, [queryClient, spaceId])

  const createMilestone = useCallback(
    async (input: CreateMilestoneInput): Promise<Milestone> => {
      const tempId = crypto.randomUUID()
      const now = new Date().toISOString()
      const orderKey = Date.now()

      // Optimistic update
      const optimisticMilestone: Milestone = {
        id: tempId,
        org_id: '', // Will be set by DB
        space_id: spaceId,
        name: input.name,
        start_date: input.startDate ?? null,
        due_date: input.dueDate ?? null,
        order_key: orderKey,
        completed_at: null,
        created_at: now,
        updated_at: now,
      }

      queryClient.setQueryData<Milestone[]>(['milestones', spaceId], (old) => [
        ...(old ?? []),
        optimisticMilestone,
      ])

      try {
        const { data: created, error: err } = await (supabase as SupabaseClient)
          .from('milestones')
          .insert({
            space_id: spaceId,
            name: input.name,
            start_date: input.startDate ?? null,
            due_date: input.dueDate ?? null,
            order_key: orderKey,
          })
          .select('*')
          .single()

        if (err) throw err

        const createdMilestone = created as Milestone
        queryClient.setQueryData<Milestone[]>(['milestones', spaceId], (old) =>
          (old ?? []).map((m) => (m.id === tempId ? createdMilestone : m))
        )
        // 設定タブの件数表示（「テンプレートを適用」の出し分け等）が古いままにならないよう促す
        void queryClient.invalidateQueries({ queryKey: ['spaceContentCounts', spaceId] })

        return createdMilestone
      } catch (err) {
        // Revert optimistic update
        queryClient.setQueryData<Milestone[]>(['milestones', spaceId], (old) =>
          (old ?? []).filter((m) => m.id !== tempId)
        )
        throw err instanceof Error ? err : new Error('Failed to create milestone')
      }
    },
    [spaceId, supabase, queryClient]
  )

  const updateMilestone = useCallback(
    async (id: string, input: UpdateMilestoneInput): Promise<void> => {
      // Capture previous state for rollback
      const previousData = queryClient.getQueryData<Milestone[]>(['milestones', spaceId])

      // Optimistic update
      queryClient.setQueryData<Milestone[]>(['milestones', spaceId], (old) =>
        (old ?? []).map((m) =>
          m.id === id
            ? {
                ...m,
                name: input.name ?? m.name,
                start_date: input.startDate !== undefined ? input.startDate : m.start_date,
                due_date: input.dueDate !== undefined ? input.dueDate : m.due_date,
                order_key: input.orderKey ?? m.order_key,
                updated_at: new Date().toISOString(),
              }
            : m
        )
      )

      try {
        const updateData: Record<string, unknown> = {}
        if (input.name !== undefined) updateData.name = input.name
        if (input.startDate !== undefined) updateData.start_date = input.startDate
        if (input.dueDate !== undefined) updateData.due_date = input.dueDate
        if (input.orderKey !== undefined) updateData.order_key = input.orderKey

        const { error: err } = await (supabase as SupabaseClient)
          .from('milestones')
          .update(updateData)
          .eq('id' as never, id as never)

        if (err) throw err
      } catch (err) {
        // Revert optimistic update
        if (previousData) {
          queryClient.setQueryData<Milestone[]>(['milestones', spaceId], previousData)
        }
        throw err instanceof Error ? err : new Error('Failed to update milestone')
      }
    },
    [supabase, spaceId, queryClient]
  )

  const deleteMilestone = useCallback(
    async (id: string): Promise<void> => {
      // Capture previous state for rollback
      const previousData = queryClient.getQueryData<Milestone[]>(['milestones', spaceId])

      // Optimistic update
      queryClient.setQueryData<Milestone[]>(['milestones', spaceId], (old) =>
        (old ?? []).filter((m) => m.id !== id)
      )

      try {
        const { error: err } = await (supabase as SupabaseClient)
          .from('milestones')
          .delete()
          .eq('id' as never, id as never)

        if (err) throw err

        // DB は ON DELETE SET NULL でタスク側の milestone_id を外すが、タスク一覧
        // （['tasks', orgId, spaceId]）のキャッシュは取り直すまで古い milestone_id を
        // 持ったまま。一覧・ガントは既知のマイルストーンか null のタスクしかグループに
        // しないため、取り直しが終わるまでタスクが消えて見えてしまう。ここで直接書き換える
        queryClient.setQueriesData<TasksQueryData>(
          { predicate: (query) => query.queryKey[0] === 'tasks' && query.queryKey[2] === spaceId },
          (old) =>
            old
              ? {
                  ...old,
                  tasks: old.tasks.map((t) =>
                    t.milestone_id === id ? { ...t, milestone_id: null } : t
                  ),
                }
              : old
        )
        // 設定タブの件数表示が古いままにならないよう促す
        void queryClient.invalidateQueries({ queryKey: ['spaceContentCounts', spaceId] })
      } catch (err) {
        // Revert optimistic update
        if (previousData) {
          queryClient.setQueryData<Milestone[]>(['milestones', spaceId], previousData)
        }
        throw err instanceof Error ? err : new Error('Failed to delete milestone')
      }
    },
    [supabase, spaceId, queryClient]
  )

  return {
    milestones,
    loading: isPending && !data,
    error: queryError,
    isLoadingError,
    fetchMilestones,
    createMilestone,
    updateMilestone,
    deleteMilestone,
  }
}
