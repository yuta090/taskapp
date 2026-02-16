'use client'

import { useRef, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'
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
  fetchMilestones: () => Promise<void>
  createMilestone: (input: CreateMilestoneInput) => Promise<Milestone>
  updateMilestone: (id: string, input: UpdateMilestoneInput) => Promise<void>
  deleteMilestone: (id: string) => Promise<void>
}

export function useMilestones({ spaceId }: UseMilestonesOptions): UseMilestonesReturn {
  const queryClient = useQueryClient()

  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  const queryKey = ['milestones', spaceId] as const

  const { data, isPending, error: queryError } = useQuery<Milestone[]>({
    queryKey,
    queryFn: async (): Promise<Milestone[]> => {
      const { data: milestonesData, error: err } = await (supabase as SupabaseClient)
        .from('milestones')
        .select('*')
        .eq('space_id' as never, spaceId as never)
        .order('order_key' as never, { ascending: true })

      if (err) throw err
      return (milestonesData || []) as Milestone[]
    },
    staleTime: 30_000,
    enabled: !!spaceId,
  })

  const milestones = data ?? []

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
    fetchMilestones,
    createMilestone,
    updateMilestone,
    deleteMilestone,
  }
}
