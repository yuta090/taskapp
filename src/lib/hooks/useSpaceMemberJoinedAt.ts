'use client'

import { useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * 参加者の「参加日」だけを取る。
 *
 * 一覧そのものは useSpaceMembers（rpc_get_space_members）が正本で、そこに参加日は含まれない。
 * 参加日を出すのはメンバー設定画面だけなので、一覧とは別のクエリに分けて、
 * 他の画面が余計な列を取らないようにしている。
 *
 * RLS で読めないことがあるが、その場合も一覧は出せるので空で返す（画面を落とさない）。
 */
export function useSpaceMemberJoinedAt(spaceId: string | null, enabled = true) {
  const supabaseRef = useRef<SupabaseClient | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient() as SupabaseClient

  const { data } = useQuery<Record<string, string>>({
    queryKey: ['spaceMemberJoinedAt', spaceId],
    queryFn: async (): Promise<Record<string, string>> => {
      const { data, error } = await supabaseRef
        .current!.from('space_memberships')
        .select('user_id, created_at')
        .eq('space_id', spaceId!)

      if (error) {
        console.warn('Could not fetch membership details:', error)
        return {}
      }

      const byUser: Record<string, string> = {}
      for (const row of (data ?? []) as { user_id: string; created_at: string }[]) {
        byUser[row.user_id] = row.created_at
      }
      return byUser
    },
    enabled: !!spaceId && enabled,
    // アプリ既定(2分)に揃える。参加日は参加者一覧と同じ頻度でしか変わらない。
    staleTime: 2 * 60_000,
  })

  return data ?? null
}
