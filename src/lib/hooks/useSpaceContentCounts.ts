'use client'

import { useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'

export interface SpaceContentCounts {
  members: number
  wikiPages: number
  milestones: number
}

/**
 * プロジェクトの中身の件数（参加者・Wiki・マイルストーン）。
 *
 * 「はじめての設定」バナーと「初期構成」が、それぞれ別々に同じ件数を数えていたので1本にまとめた。
 * 件数だけ数える(head)ので本文は取ってこない。
 */
export function useSpaceContentCounts(spaceId: string | null) {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()

  const { data, isPending, isError } = useQuery<SpaceContentCounts>({
    queryKey: ['spaceContentCounts', spaceId],
    queryFn: async (): Promise<SpaceContentCounts> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabaseRef.current as any
      const [memberRes, wikiRes, msRes] = await Promise.all([
        sb.from('space_memberships').select('id', { count: 'exact', head: true }).eq('space_id', spaceId),
        sb.from('wiki_pages').select('id', { count: 'exact', head: true }).eq('space_id', spaceId),
        sb.from('milestones').select('id', { count: 'exact', head: true }).eq('space_id', spaceId),
      ])

      // Supabase は throw せず { error } で返すので明示的に見る
      if (memberRes.error || wikiRes.error || msRes.error) {
        throw memberRes.error ?? wikiRes.error ?? msRes.error
      }

      return {
        members: (memberRes.count ?? 0) as number,
        wikiPages: (wikiRes.count ?? 0) as number,
        milestones: (msRes.count ?? 0) as number,
      }
    },
    enabled: !!spaceId,
    // アプリ既定(2分)に揃える
    staleTime: 2 * 60_000,
  })

  return {
    counts: data ?? null,
    isPending: !!spaceId && isPending,
    isError,
  }
}
