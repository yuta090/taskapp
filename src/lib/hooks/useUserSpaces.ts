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
}

/**
 * ユーザーが所属する全スペースを取得するフック
 */
export function useUserSpaces() {
  const queryClient = useQueryClient()
  const { user, loading: userLoading } = useCurrentUser()

  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  const queryKey = useMemo(() => ['userSpaces', user?.id] as const, [user?.id])

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
            organizations (
              id,
              name
            )
          )
        `)
        .eq('user_id', user.id)

      if (memberError) throw memberError

      return (memberships || []).map((m: Record<string, unknown>) => {
        const spaces = m.spaces as { id: string; name: string; org_id: string; organizations?: { name: string } | null } | null
        return {
          id: spaces?.id || '',
          name: spaces?.name || '',
          orgId: spaces?.org_id || '',
          orgName: (spaces?.organizations as { name?: string } | null)?.name || 'Unknown',
          role: m.role as UserSpace['role'],
        }
      }) as UserSpace[]
    },
    staleTime: 30_000,
    enabled: !!user,
  })

  const refetch = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey })
  }, [queryClient, queryKey])

  return {
    spaces: data ?? [],
    loading: userLoading || isLoading,
    error: queryError ? (queryError instanceof Error ? queryError.message : 'スペースの取得に失敗しました') : null,
    refetch,
  }
}
