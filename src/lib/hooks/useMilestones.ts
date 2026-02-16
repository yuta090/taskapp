'use client'

import { useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Milestone } from '@/types/database'
import type { SupabaseClient } from '@supabase/supabase-js'

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
  const [milestones, setMilestones] = useState<Milestone[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (!supabaseRef.current) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  const fetchMilestones = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
       
      const { data, error: err } = await (supabase as SupabaseClient)
        .from('milestones')
        .select('*')
        .eq('space_id' as never, spaceId as never)
        .order('order_key' as never, { ascending: true })

      if (err) throw err
      setMilestones((data || []) as Milestone[])
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch milestones'))
    } finally {
      setLoading(false)
    }
  }, [spaceId, supabase])

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

      setMilestones((prev) => [...prev, optimisticMilestone])

      try {
         
        const { data, error: err } = await (supabase as SupabaseClient)
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

        const created = data as Milestone
        setMilestones((prev) =>
          prev.map((m) => (m.id === tempId ? created : m))
        )

        return created
      } catch (err) {
        // Revert optimistic update
        setMilestones((prev) => prev.filter((m) => m.id !== tempId))
        throw err instanceof Error ? err : new Error('Failed to create milestone')
      }
    },
    [spaceId, supabase]
  )

  const updateMilestone = useCallback(
    async (id: string, input: UpdateMilestoneInput): Promise<void> => {
      // Store previous state for rollback
      const prevMilestones = milestones

      // Optimistic update
      setMilestones((prev) =>
        prev.map((m) =>
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
        setMilestones(prevMilestones)
        throw err instanceof Error ? err : new Error('Failed to update milestone')
      }
    },
    [milestones, supabase]
  )

  const deleteMilestone = useCallback(
    async (id: string): Promise<void> => {
      // Store previous state for rollback
      const prevMilestones = milestones

      // Optimistic update
      setMilestones((prev) => prev.filter((m) => m.id !== id))

      try {
         
        const { error: err } = await (supabase as SupabaseClient)
          .from('milestones')
          .delete()
          .eq('id' as never, id as never)

        if (err) throw err
      } catch (err) {
        // Revert optimistic update
        setMilestones(prevMilestones)
        throw err instanceof Error ? err : new Error('Failed to delete milestone')
      }
    },
    [milestones, supabase]
  )

  return {
    milestones,
    loading,
    error,
    fetchMilestones,
    createMilestone,
    updateMilestone,
    deleteMilestone,
  }
}
