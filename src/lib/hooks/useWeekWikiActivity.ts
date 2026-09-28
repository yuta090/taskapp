'use client'

import { useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { DEFAULT_STALE_TIME_MS } from '@/lib/query/constants'
import type { WeekWikiPage } from '@/lib/dashboard/weekHighlights'

/**
 * ダッシュボードの「今週」向けに、先週の月曜から後に作った・更新した Wiki ページを読む。
 *
 * - 今週作ったページも updated_at は作った時刻より後なので、updated_at だけで絞れば作成と更新の両方が入る
 * - 本文は読まない（題名と日時だけ）。見える範囲は RLS に任せる
 * - 「今週」を開いていないあいだは enabled=false で読みに行かない
 */

/** 1週間ぶんとしては十分に多い上限。これを超えるほど動いたプロジェクトでも、古い更新が数えられないだけで済む */
export const WEEK_WIKI_FETCH_LIMIT = 300

const EMPTY_PAGES: WeekWikiPage[] = []

export function useWeekWikiActivity(
  spaceId: string,
  /** 読み始める日（日本時間の 'YYYY-MM-DD'。先週の月曜） */
  since: string,
  options: { enabled: boolean }
): { pages: WeekWikiPage[]; loading: boolean; error: unknown } {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  const { data, isPending, error } = useQuery<WeekWikiPage[]>({
    queryKey: ['weekWikiActivity', spaceId, since],
    queryFn: async () => {
      const { data, error } = await (supabase as SupabaseClient)
        .from('wiki_pages')
        .select('id, title, created_at, updated_at')
        .eq('space_id', spaceId)
        // 日本時間のその日の0時から
        .gte('updated_at', `${since}T00:00:00+09:00`)
        .order('updated_at', { ascending: false })
        .limit(WEEK_WIKI_FETCH_LIMIT)
      if (error) throw error
      return (data ?? []) as WeekWikiPage[]
    },
    staleTime: DEFAULT_STALE_TIME_MS,
    enabled: !!spaceId && options.enabled,
  })

  return {
    pages: data ?? EMPTY_PAGES,
    loading: options.enabled && isPending && !data,
    error: error ?? null,
  }
}
