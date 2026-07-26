'use client'

import { useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * スペース（プロジェクト）名を取得する共通フック。
 * queryKey は TasksPageClient の既存クエリと揃えてあり、キャッシュを共有する。
 * 取得前・失敗時は空文字を返すので、呼び出し側で `spaceName || 'プロジェクト'` のように
 * フォールバックすること（パンくずに開発用サンプル名を残さないため）。
 */
export function useSpaceName(spaceId: string): string {
  const supabaseRef = useRef<SupabaseClient | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient() as SupabaseClient

  const { data } = useQuery<string>({
    queryKey: ['spaceName', spaceId],
    queryFn: async (): Promise<string> => {
      const { data } = await supabaseRef.current!
        .from('spaces')
        .select('name')
        .eq('id', spaceId)
        .single()
      return (data as { name: string } | null)?.name ?? ''
    },
    staleTime: 30_000,
    enabled: !!spaceId,
  })

  return data ?? ''
}
