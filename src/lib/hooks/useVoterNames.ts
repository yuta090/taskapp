'use client'

import { useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { DocPollState } from '@/lib/doc-polls/types'

const UNKNOWN = '（メンバー外の人）'

/**
 * 投票で押した人の名前を引く（メンバー一覧を持たない相手先ポータル用）。
 * 票と履歴に出てくる人だけを、表示名の列だけまとめて1回で読む。読めるのは「一緒に仕事をしている人」だけ
 * （profiles の決まり）で、読めない人は言葉で出す。メールアドレスは読まない。
 */
export function useVoterNames(polls: Record<string, DocPollState> | null): (userId: string) => string {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  const ids = useMemo(() => {
    if (!polls) return []
    const set = new Set<string>()
    for (const s of Object.values(polls)) {
      for (const v of s.votes) set.add(v.user_id)
      for (const e of s.events) set.add(e.user_id)
    }
    return [...set].sort()
  }, [polls])

  const { data } = useQuery({
    queryKey: ['voterNames', ids],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('id, display_name').in('id', ids)
      if (error) throw error
      // 画面の一時保存（永続キャッシュ）に載せるので、Map でなく普通のオブジェクトにする
      return Object.fromEntries((data ?? []).map((p: { id: string; display_name: string | null }) => [p.id, p.display_name ?? ''])) as Record<string, string>
    },
    enabled: ids.length > 0,
    staleTime: 5 * 60_000,
  })

  return useMemo(() => (userId: string) => data?.[userId] || UNKNOWN, [data])
}
