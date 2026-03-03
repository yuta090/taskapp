'use client'

import { useCallback, useMemo, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface SpaceGroupItem {
  id: string
  name: string
  sortOrder: number
}

/**
 * 組織のスペースグループ（フォルダ）を管理するフック
 */
export function useSpaceGroups(orgId: string) {
  const queryClient = useQueryClient()

  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current as SupabaseClient

  const queryKey = useMemo(() => ['spaceGroups', orgId] as const, [orgId])

  const { data, isLoading } = useQuery<SpaceGroupItem[]>({
    queryKey,
    queryFn: async (): Promise<SpaceGroupItem[]> => {
      if (!orgId) return []

      const { data, error } = await supabase
        .from('space_groups')
        .select('id, name, sort_order')
        .eq('org_id', orgId)
        .order('sort_order', { ascending: true })

      if (error) throw error

      return (data || []).map((g: { id: string; name: string; sort_order: number }) => ({
        id: g.id,
        name: g.name,
        sortOrder: g.sort_order,
      }))
    },
    staleTime: 30_000,
    enabled: !!orgId,
  })

  const invalidate = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey })
  }, [queryClient, queryKey])

  const createGroup = useCallback(async (name: string): Promise<SpaceGroupItem> => {
    const maxOrder = (data ?? []).reduce((max, g) => Math.max(max, g.sortOrder), 0)
    const { data: created, error } = await supabase
      .from('space_groups')
      .insert({ org_id: orgId, name, sort_order: maxOrder + 1 })
      .select('id, name, sort_order')
      .single()

    if (error) throw error
    await invalidate()
    return { id: created.id, name: created.name, sortOrder: created.sort_order }
  }, [supabase, orgId, data, invalidate])

  const renameGroup = useCallback(async (groupId: string, name: string) => {
    const { error } = await supabase
      .from('space_groups')
      .update({ name })
      .eq('id', groupId)

    if (error) throw error
    await invalidate()
  }, [supabase, invalidate])

  const deleteGroup = useCallback(async (groupId: string) => {
    await supabase
      .from('spaces')
      .update({ group_id: null })
      .eq('group_id', groupId)

    const { error } = await supabase
      .from('space_groups')
      .delete()
      .eq('id', groupId)

    if (error) throw error
    await Promise.all([
      invalidate(),
      queryClient.invalidateQueries({ queryKey: ['userSpaces'] }),
    ])
  }, [supabase, invalidate, queryClient])

  const reorderGroups = useCallback(async (orderedIds: string[]) => {
    const updates = orderedIds.map((id, index) =>
      supabase
        .from('space_groups')
        .update({ sort_order: index })
        .eq('id', id)
    )
    await Promise.all(updates)
    await invalidate()
  }, [supabase, invalidate])

  const moveSpaceToGroup = useCallback(async (spaceId: string, groupId: string | null) => {
    const { error } = await supabase
      .from('spaces')
      .update({ group_id: groupId })
      .eq('id', spaceId)

    if (error) throw error
    await queryClient.invalidateQueries({ queryKey: ['userSpaces'] })
  }, [supabase, queryClient])

  return {
    groups: data ?? [],
    loading: isLoading,
    createGroup,
    renameGroup,
    deleteGroup,
    reorderGroups,
    moveSpaceToGroup,
  }
}
