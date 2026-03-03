'use client'

import { useCallback, useMemo, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'
import { useCurrentUser } from './useCurrentUser'

/**
 * スペースのアーカイブ状態を管理するフック
 */
export function useSpaceArchive(spaceId: string) {
  const queryClient = useQueryClient()
  const { user } = useCurrentUser()

  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  const { data } = useQuery({
    queryKey: ['spaceArchive', spaceId],
    queryFn: async () => {
      const { data, error } = await (supabase as SupabaseClient)
        .from('spaces')
        .select('archived_at, archived_by')
        .eq('id', spaceId)
        .single()
      if (error) throw error
      return data as { archived_at: string | null; archived_by: string | null }
    },
    staleTime: 30_000,
    enabled: !!spaceId,
  })

  const invalidate = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['spaceArchive', spaceId] }),
      queryClient.invalidateQueries({ queryKey: ['userSpaces'] }),
    ])
  }, [queryClient, spaceId])

  const archive = useCallback(async () => {
    if (!user) throw new Error('ログインが必要です')
    const { error } = await (supabase as SupabaseClient)
      .from('spaces')
      .update({ archived_at: new Date().toISOString(), archived_by: user.id })
      .eq('id', spaceId)
    if (error) throw error
    await invalidate()
  }, [supabase, spaceId, user, invalidate])

  const unarchive = useCallback(async () => {
    const { error } = await (supabase as SupabaseClient)
      .from('spaces')
      .update({ archived_at: null, archived_by: null })
      .eq('id', spaceId)
    if (error) throw error
    await invalidate()
  }, [supabase, spaceId, invalidate])

  return useMemo(() => ({
    isArchived: data?.archived_at !== null && data?.archived_at !== undefined,
    archivedAt: data?.archived_at ?? null,
    archive,
    unarchive,
  }), [data, archive, unarchive])
}
