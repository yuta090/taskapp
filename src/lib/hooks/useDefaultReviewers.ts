'use client'

import { useCallback, useMemo, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'
import { toggleDefaultReviewer } from '@/lib/review/defaultReviewers'

// 読み込み中に毎回新しい [] を返すと、呼び出し側の useMemo が毎レンダー無効になるため共有定数にする
const EMPTY: string[] = []

/**
 * プロジェクトの「既定の承認者」の読み書き。
 *
 * 保存先は spaces.default_reviewer_ids（配列まるごとの更新）。
 * 2人が同時に別の人をチェックすると後の保存が勝つが、初期値の設定なので
 * 取り違えの実害は小さく、チェックし直せば済む範囲に収めている。
 */
export function useDefaultReviewers(spaceId: string | null) {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  const queryClient = useQueryClient()
  const queryKey = useMemo(() => ['defaultReviewers', spaceId] as const, [spaceId])

  const query = useQuery({
    queryKey,
    enabled: !!spaceId,
    // 承認者の顔ぶれは頻繁には変わらない。タスクを開くたびに取り直さない
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await (supabase as SupabaseClient)
        .from('spaces')
        .select('default_reviewer_ids')
        .eq('id', spaceId!)
        .single()

      if (error) throw error
      return (data?.default_reviewer_ids as string[] | null) ?? []
    },
  })

  const mutation = useMutation({
    mutationFn: async (next: string[]) => {
      const { error } = await (supabase as SupabaseClient)
        .from('spaces')
        .update({ default_reviewer_ids: next })
        .eq('id', spaceId!)

      if (error) throw error
    },
    // 保存ボタンを置かない方針なので、押した瞬間に反映し、失敗したときだけ戻す
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<string[]>(queryKey)
      queryClient.setQueryData<string[]>(queryKey, next)
      return { previous }
    },
    onError: (_err, _next, context) => {
      queryClient.setQueryData<string[]>(queryKey, context?.previous ?? [])
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey })
    },
  })

  const { mutateAsync } = mutation

  const setDefaultReviewer = useCallback(
    async (userId: string, isDefault: boolean) => {
      const current = queryClient.getQueryData<string[]>(queryKey) ?? []
      await mutateAsync(toggleDefaultReviewer(current, userId, isDefault))
    },
    [queryClient, queryKey, mutateAsync]
  )

  return {
    defaultReviewerIds: query.data ?? EMPTY,
    loading: !!spaceId && query.isPending && !query.data,
    saving: mutation.isPending,
    setDefaultReviewer,
  }
}
