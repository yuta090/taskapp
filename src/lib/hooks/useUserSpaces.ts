'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
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
  const { user, loading: userLoading } = useCurrentUser()
  const [spaces, setSpaces] = useState<UserSpace[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const supabase = useMemo(() => createClient(), [])
  const requestIdRef = useRef(0)

  const fetchSpaces = useCallback(async () => {
    if (!user) {
      setSpaces([])
      setLoading(false)
      return
    }

    const currentRequestId = ++requestIdRef.current
    setLoading(true)
    setError(null)

    try {
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

      // 古いリクエストの結果は無視
      if (currentRequestId !== requestIdRef.current) return

      if (memberError) throw memberError

      const userSpaces = (memberships || []).map((m: Record<string, unknown>) => {
        const spaces = m.spaces as { id: string; name: string; org_id: string; organizations?: { name: string } | null } | null
        return {
          id: spaces?.id || '',
          name: spaces?.name || '',
          orgId: spaces?.org_id || '',
          orgName: (spaces?.organizations as { name?: string } | null)?.name || 'Unknown',
          role: m.role as UserSpace['role'],
        }
      }) as UserSpace[]

      setSpaces(userSpaces)
    } catch (err) {
      console.error('Failed to fetch user spaces:', err)
      if (currentRequestId === requestIdRef.current) {
        setError('スペースの取得に失敗しました')
      }
    } finally {
      if (currentRequestId === requestIdRef.current) {
        setLoading(false)
      }
    }
  }, [user, supabase])

  useEffect(() => {
    if (!userLoading) {
      void fetchSpaces()
    }
  }, [userLoading, fetchSpaces])

  return {
    spaces,
    loading: userLoading || loading,
    error,
    refetch: fetchSpaces,
  }
}
