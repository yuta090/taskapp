'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface VendorSettings {
  show_client_name: boolean
  allow_client_comments: boolean
}

export interface AgencyModeData {
  agency_mode: boolean
  default_margin_rate: number | null
  vendor_settings: VendorSettings
}

const DEFAULT_VENDOR_SETTINGS: VendorSettings = {
  show_client_name: false,
  allow_client_comments: false,
}

export function useAgencyMode(spaceId: string | null) {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  const queryClient = useQueryClient()
  const queryKey = ['agencyMode', spaceId]

  const query = useQuery({
    queryKey,
    enabled: !!spaceId,
    queryFn: async (): Promise<AgencyModeData> => {
      const { data, error } = await (supabase as SupabaseClient)
        .from('spaces')
        .select('agency_mode, default_margin_rate, vendor_settings')
        .eq('id', spaceId!)
        .single()

      if (error) throw error
      return {
        agency_mode: data?.agency_mode ?? false,
        default_margin_rate: data?.default_margin_rate ?? null,
        vendor_settings: {
          ...DEFAULT_VENDOR_SETTINGS,
          ...(data?.vendor_settings as Partial<VendorSettings> | null),
        },
      }
    },
  })

  const mutation = useMutation({
    mutationFn: async (updates: Partial<AgencyModeData>) => {
      const { error } = await (supabase as SupabaseClient)
        .from('spaces')
        .update(updates)
        .eq('id', spaceId!)

      if (error) throw error
    },
    onMutate: async (updates) => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<AgencyModeData>(queryKey)
      if (previous) {
        queryClient.setQueryData<AgencyModeData>(queryKey, { ...previous, ...updates })
      }
      return { previous }
    },
    onError: (_err, _updates, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous)
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey })
    },
  })

  return {
    data: query.data ?? { agency_mode: false, default_margin_rate: null, vendor_settings: DEFAULT_VENDOR_SETTINGS },
    loading: query.isLoading,
    update: mutation.mutateAsync,
  }
}
