'use client'

import { useRef, useMemo, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getCachedUser } from '@/lib/supabase/cached-auth'

export interface SpaceMember {
  id: string          // user_id
  displayName: string // profiles.display_name
  avatarUrl: string | null
  role: string        // admin | editor | viewer | client (from DB)
}

interface UseSpaceMembersResult {
  members: SpaceMember[]
  clientMembers: SpaceMember[]
  internalMembers: SpaceMember[]
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
  getMemberName: (userId: string) => string
}

export function useSpaceMembers(spaceId: string | null): UseSpaceMembersResult {
  const queryClient = useQueryClient()

  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  const queryKey = ['spaceMembers', spaceId] as const

  const { data: members = [], isPending, error: queryError } = useQuery<SpaceMember[]>({
    queryKey,
    queryFn: async (): Promise<SpaceMember[]> => {
      if (!spaceId) return []

      const { user, error: userError } = await getCachedUser(supabase)
      if (userError || !user) {
        throw new Error('ログインが必要です')
      }

      // Use RPC to get space members with profiles (avoids FK/relationship issues)
      const { data, error: fetchError } = await (supabase as SupabaseClient)
        .rpc('rpc_get_space_members', { p_space_id: spaceId })

      if (fetchError) throw fetchError

      return (data || []).map((m: { user_id: string; display_name: string | null; avatar_url: string | null; role: string }) => ({
        id: m.user_id,
        displayName: m.display_name || m.user_id.slice(0, 8) + '...',
        avatarUrl: m.avatar_url || null,
        role: m.role,
      }))
    },
    staleTime: 30_000,
    enabled: !!spaceId,
  })

  // Filter by role (DB uses: admin, editor, viewer, client)
  const clientMembers = useMemo(
    () => members.filter((m) => m.role === 'client'),
    [members]
  )

  const internalMembers = useMemo(
    () => members.filter((m) => m.role !== 'client'), // admin, editor, viewer
    [members]
  )

  // Helper to get member name by ID
  const getMemberName = useCallback(
    (userId: string): string => {
      const member = members.find((m) => m.id === userId)
      return member?.displayName || userId.slice(0, 8) + '...'
    },
    [members]
  )

  const refetch = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['spaceMembers', spaceId] })
  }, [queryClient, spaceId])

  // Convert Error to string for backward compatibility
  const errorMessage = queryError ? (queryError instanceof Error ? queryError.message : 'メンバー情報の取得に失敗しました') : null

  return {
    members,
    clientMembers,
    internalMembers,
    loading: isPending && !members,
    error: errorMessage,
    refetch,
    getMemberName,
  }
}

/**
 * Hook to get a single user's display name
 */
export function useUserName(userId: string | null): {
  name: string
  loading: boolean
} {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  const { data: name = '', isPending } = useQuery<string>({
    queryKey: ['userName', userId],
    queryFn: async (): Promise<string> => {
      if (!userId) return ''

      const { data, error } = await (supabase as SupabaseClient)
        .from('profiles')
        .select('display_name')
        .eq('id', userId)
        .single()

      if (error) throw error
      return data?.display_name || userId.slice(0, 8) + '...'
    },
    staleTime: 30_000,
    enabled: !!userId,
  })

  return { name, loading: isPending && !name }
}
