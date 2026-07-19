'use client'

import { useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { getCachedUser } from '@/lib/supabase/cached-auth'
import { AuthSessionMissingError, type User } from '@supabase/supabase-js'

export interface CurrentUserState {
  user: User | null
  loading: boolean
  error: string | null
}

export function useCurrentUser(): CurrentUserState {
  // Created once per hook instance and reused across refetches.
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()

  const { data, isPending, error } = useQuery<User | null>({
    queryKey: ['currentUser'],
    queryFn: async () => {
      try {
        const { user: fetchedUser, error: userError } = await getCachedUser(supabaseRef.current!)

        if (userError) {
          throw userError
        }

        return fetchedUser
      } catch (err) {
        // 未ログイン時の「セッションなし」は正常系。ノイズになるためログせずエラー扱いしない。
        if (err instanceof AuthSessionMissingError) {
          return null
        }

        console.error('Failed to fetch user:', err)
        throw new Error('ユーザー情報の取得に失敗しました')
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  })

  return {
    user: data ?? null,
    loading: isPending,
    error: error ? error.message : null,
  }
}
