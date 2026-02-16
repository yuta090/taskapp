'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getCachedUser, invalidateCachedUser } from '@/lib/supabase/cached-auth'
import type { User } from '@supabase/supabase-js'

export interface CurrentUserState {
  user: User | null
  loading: boolean
  error: string | null
}

export function useCurrentUser(): CurrentUserState {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()

    const fetchUser = async () => {
      try {
        const { user: fetchedUser, error: userError } = await getCachedUser(supabase)

        if (userError) {
          throw userError
        }

        setUser(fetchedUser)
        setError(null)
      } catch (err) {
        console.error('Failed to fetch user:', err)
        setError('ユーザー情報の取得に失敗しました')
        setUser(null)
      } finally {
        setLoading(false)
      }
    }

    fetchUser()

    // Listen for auth changes — invalidate cache on logout/login
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      invalidateCachedUser()
      setUser(session?.user ?? null)
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  return { user, loading, error }
}
