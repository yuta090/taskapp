'use client'

import { useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'

/** 重ねて読むのに要るぶんだけ */
export interface WikiPageDetail {
  id: string
  title: string
  body: string | null
  updated_at: string
}

interface UseWikiPageDetailResult {
  page: WikiPageDetail | null
  loading: boolean
  error: Error | null
}

/**
 * Wiki のページ1件（本文つき）。議事録の上に Wiki を重ねて読むのに使う。
 *
 * useWikiPages は一覧（本文なし）を読むので使わない。1件のために一覧ごと読むことになるうえ、
 * 空のプロジェクトでは最初のページを作る処理まで走る。問い合わせは useWikiPages.fetchPage と同じ。
 */
export function useWikiPageDetail(orgId: string, pageId: string | null): UseWikiPageDetailResult {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  const enabled = !!orgId && !!pageId

  const { data, isPending, error } = useQuery<WikiPageDetail | null>({
    queryKey: ['wikiPageDetail', orgId, pageId] as const,
    queryFn: async () => {
      const { data: row, error: fetchError } = await (supabase as SupabaseClient)
        .from('wiki_pages')
        .select('id, title, body, updated_at')
        .eq('id', pageId as string)
        .eq('org_id', orgId)
        .maybeSingle()
      if (fetchError) throw fetchError
      return (row as WikiPageDetail | null) ?? null
    },
    enabled,
    // 会議中はほかの人が資料を直していることがある。開くたびに読み直す
    // （手元にあればそれを先に出すので、待ち時間は増えない）
    staleTime: 0,
    // 読んでいる途中にタブへ戻っただけで本文が差し替わると、表示が作り直されて位置が飛ぶ
    refetchOnWindowFocus: false,
  })

  return {
    page: data ?? null,
    loading: enabled && isPending && !error,
    error: (error as Error | null) ?? null,
  }
}
