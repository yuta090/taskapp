'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface TaskPricing {
  id: string
  org_id: string
  space_id: string
  task_id: string
  cost_hours: number | null
  cost_unit_price: number | null
  cost_total: number | null
  sell_mode: 'margin' | 'fixed'
  margin_rate: number | null
  sell_total: number | null
  vendor_submitted_at: string | null
  agency_approved_at: string | null
  client_approved_at: string | null
  created_at: string
  updated_at: string
}

interface UseTaskPricingOptions {
  taskId: string
  orgId: string
  spaceId: string
}

export function useTaskPricing({ taskId, orgId, spaceId }: UseTaskPricingOptions) {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  const queryClient = useQueryClient()
  const queryKey = ['taskPricing', taskId]

  const query = useQuery({
    queryKey,
    enabled: !!taskId,
    queryFn: async (): Promise<TaskPricing | null> => {
      const { data, error } = await (supabase as SupabaseClient)
        .from('task_pricing')
        .select('*')
        .eq('task_id', taskId)
        .maybeSingle()

      if (error) throw error
      return data as TaskPricing | null
    },
  })

  const upsertMutation = useMutation({
    mutationFn: async (updates: Partial<Omit<TaskPricing, 'id' | 'cost_total' | 'created_at' | 'updated_at'>>) => {
      const payload = {
        org_id: orgId,
        space_id: spaceId,
        task_id: taskId,
        ...updates,
      }

      // Auto-calculate sell_total for margin mode
      if (updates.sell_mode === 'margin' || (!updates.sell_mode && (query.data?.sell_mode ?? 'margin') === 'margin')) {
        const costHours = updates.cost_hours ?? query.data?.cost_hours
        const costUnitPrice = updates.cost_unit_price ?? query.data?.cost_unit_price
        const marginRate = updates.margin_rate ?? query.data?.margin_rate
        if (costHours != null && costUnitPrice != null && marginRate != null) {
          const costTotal = costHours * costUnitPrice
          payload.sell_total = Math.round(costTotal * (1 + marginRate / 100))
        }
      }

      const { data, error } = await (supabase as SupabaseClient)
        .from('task_pricing')
        .upsert(payload, { onConflict: 'task_id' })
        .select()
        .single()

      if (error) throw error
      return data as TaskPricing
    },
    onSuccess: (data) => {
      queryClient.setQueryData<TaskPricing | null>(queryKey, data)
    },
  })

  return {
    pricing: query.data ?? null,
    loading: query.isLoading,
    upsert: upsertMutation.mutateAsync,
    saving: upsertMutation.isPending,
  }
}
