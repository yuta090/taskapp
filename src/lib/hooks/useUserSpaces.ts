'use client'

import { useCallback, useMemo, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'
import { useCurrentUser } from './useCurrentUser'

export interface UserSpace {
  id: string
  name: string
  orgId: string
  orgName: string
  role: 'admin' | 'editor' | 'viewer' | 'client'
  archivedAt: string | null
  groupId: string | null
  sortOrder: number
}

interface UseUserSpacesOptions {
  includeArchived?: boolean
}

/**
 * ユーザーが所属する全スペースを取得するフック
 */
export function useUserSpaces(options?: UseUserSpacesOptions) {
  const { includeArchived = false } = options ?? {}
  const queryClient = useQueryClient()
  const { user, loading: userLoading } = useCurrentUser()

  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  const queryKey = useMemo(
    () => ['userSpaces', user?.id, includeArchived] as const,
    [user?.id, includeArchived],
  )

  const { data, isLoading, error: queryError } = useQuery<UserSpace[]>({
    queryKey,
    queryFn: async (): Promise<UserSpace[]> => {
      if (!user) return []

      // ユーザーのスペースメンバーシップを取得
      const { data: memberships, error: memberError } = await (supabase as SupabaseClient)
        .from('space_memberships')
        .select(`
          role,
          space_id,
          spaces (
            id,
            name,
            org_id,
            archived_at,
            group_id,
            sort_order,
            organizations (
              id,
              name
            )
          )
        `)
        .eq('user_id', user.id)

      if (memberError) throw memberError

      const mapped = (memberships || []).map((m: Record<string, unknown>) => {
        const space = m.spaces as {
          id: string
          name: string
          org_id: string
          archived_at: string | null
          group_id: string | null
          sort_order: number
          organizations?: { name: string } | null
        } | null
        return {
          id: space?.id || '',
          name: space?.name || '',
          orgId: space?.org_id || '',
          orgName: (space?.organizations as { name?: string } | null)?.name || 'Unknown',
          role: m.role as UserSpace['role'],
          archivedAt: space?.archived_at ?? null,
          groupId: space?.group_id ?? null,
          sortOrder: space?.sort_order ?? 0,
        }
      }) as UserSpace[]

      if (!includeArchived) {
        return mapped.filter((s) => s.archivedAt === null)
      }
      return mapped
    },
    staleTime: 30_000,
    enabled: !!user,
  })

  const refetch = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['userSpaces'] })
  }, [queryClient])

  return {
    spaces: data ?? [],
    loading: userLoading || isLoading,
    error: queryError ? (queryError instanceof Error ? queryError.message : 'スペースの取得に失敗しました') : null,
    refetch,
  }
}
