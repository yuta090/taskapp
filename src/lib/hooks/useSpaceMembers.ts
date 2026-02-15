'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'

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
  const [members, setMembers] = useState<SpaceMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const supabase = useMemo(() => createClient(), [])

  const fetchMembers = useCallback(async () => {
    if (!spaceId) {
      setMembers([])
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser()
      if (userError || !user) {
        setMembers([])
        setError('ログインが必要です')
        return
      }

      // Use RPC to get space members with profiles (avoids FK/relationship issues)
      const { data, error: fetchError } = await (supabase as SupabaseClient)
        .rpc('rpc_get_space_members', { p_space_id: spaceId })

      if (fetchError) throw fetchError

      const memberList: SpaceMember[] = (data || []).map((m: { user_id: string; display_name: string | null; avatar_url: string | null; role: string }) => ({
        id: m.user_id,
        displayName: m.display_name || m.user_id.slice(0, 8) + '...',
        avatarUrl: m.avatar_url || null,
        role: m.role,
      }))

      setMembers(memberList)
    } catch (err) {
      console.error('Failed to fetch space members:', err)
      setError('メンバー情報の取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }, [spaceId, supabase])

  useEffect(() => {
    void fetchMembers()
  }, [fetchMembers])

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

  return {
    members,
    clientMembers,
    internalMembers,
    loading,
    error,
    refetch: fetchMembers,
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
  const [name, setName] = useState<string>('')
  const [loading, setLoading] = useState(true)

  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    if (!userId) {
      setName('')
      setLoading(false)
      return
    }

    const fetchName = async () => {
      setLoading(true)
      try {
        const { data, error } = await (supabase as SupabaseClient)
          .from('profiles')
          .select('display_name')
          .eq('id', userId)
          .single()

        if (error) throw error
        setName(data?.display_name || userId.slice(0, 8) + '...')
      } catch {
        setName(userId.slice(0, 8) + '...')
      } finally {
        setLoading(false)
      }
    }

    void fetchName()
  }, [userId, supabase])

  return { name, loading }
}
