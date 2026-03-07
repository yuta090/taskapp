'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface PortalVisibleSections {
  tasks: boolean
  requests: boolean
  all_tasks: boolean
  files: boolean
  meetings: boolean
  wiki: boolean
  history: boolean
}

const DEFAULT_SECTIONS: PortalVisibleSections = {
  tasks: true,
  requests: true,
  all_tasks: true,
  files: true,
  meetings: true,
  wiki: false,
  history: true,
}

// ---------- Admin side: manage settings ----------

export function usePortalVisibility(spaceId: string | null) {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  const queryClient = useQueryClient()
  const queryKey = ['portalVisibility', spaceId]

  const query = useQuery({
    queryKey,
    enabled: !!spaceId,
    queryFn: async (): Promise<PortalVisibleSections> => {
      const { data, error } = await (supabase as SupabaseClient)
        .from('spaces')
        .select('portal_visible_sections')
        .eq('id', spaceId!)
        .single()

      if (error) throw error
      return { ...DEFAULT_SECTIONS, ...(data?.portal_visible_sections as Partial<PortalVisibleSections>) }
    },
  })

  const mutation = useMutation({
    mutationFn: async (sections: PortalVisibleSections) => {
      const { error } = await (supabase as SupabaseClient)
        .from('spaces')
        .update({ portal_visible_sections: sections })
        .eq('id', spaceId!)

      if (error) throw error
    },
    onMutate: async (sections) => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<PortalVisibleSections>(queryKey)
      queryClient.setQueryData<PortalVisibleSections>(queryKey, sections)
      return { previous }
    },
    onError: (_err, _sections, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous)
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey })
    },
  })

  return {
    sections: query.data ?? DEFAULT_SECTIONS,
    loading: query.isLoading,
    updateSections: mutation.mutateAsync,
  }
}

// ---------- Portal side: read-only visibility ----------

export function usePortalVisibilityForPortal(spaceId: string | null) {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  const query = useQuery({
    queryKey: ['portalVisibility', spaceId],
    enabled: !!spaceId,
    staleTime: 5 * 60 * 1000, // 5 minutes for portal (settings change infrequently)
    queryFn: async (): Promise<PortalVisibleSections> => {
      const { data, error } = await (supabase as SupabaseClient)
        .from('spaces')
        .select('portal_visible_sections')
        .eq('id', spaceId!)
        .single()

      if (error) throw error
      return { ...DEFAULT_SECTIONS, ...(data?.portal_visible_sections as Partial<PortalVisibleSections>) }
    },
  })

  return {
    sections: query.data ?? DEFAULT_SECTIONS,
    loading: query.isLoading,
  }
}
