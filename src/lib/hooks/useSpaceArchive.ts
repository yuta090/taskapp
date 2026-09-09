'use client'

import { useCallback, useMemo, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'
import { useCurrentUser } from './useCurrentUser'
import { useSpaceRow, spaceQueryKey } from './useSpaceRow'

/**
 * スペースのアーカイブ状態を管理するフック。
 * 状態そのものは useSpaceRow（プロジェクト1行）から読む。
 */
export function useSpaceArchive(spaceId: string) {
  const queryClient = useQueryClient()
  const { user } = useCurrentUser()
  const { space } = useSpaceRow(spaceId)

  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  const invalidate = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: spaceQueryKey(spaceId) }),
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
    isArchived: space?.archived_at !== null && space?.archived_at !== undefined,
    archivedAt: space?.archived_at ?? null,
    archive,
    unarchive,
  }), [space, archive, unarchive])
}
