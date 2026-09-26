'use client'

import { useCallback, useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { createDocInsertion, fetchDocInsertions, withdrawDocInsertion } from '@/lib/doc-insertions/api'
import type { DocInsertion, DocInsertionKind } from '@/lib/doc-insertions/logic'
import { onDocSignal, sendDocSignal } from '@/lib/hooks/useDocVoteSignal'

const EMPTY: DocInsertion[] = []

/**
 * 相手先ポータルの議事録で、自分の差し込み（反映待ち・反映済み・削除依頼）を持つ（DOC_VOTE_SPEC §5）。
 * 作る・取り下げるのたびに、同じ議事録を開いている社内の画面へ「差し込みが変わった」と知らせる
 * （社内の編集画面がすぐ取り込む）。社内が反映した・保存したの知らせで読み直す。
 */
export function useMyDocInsertions(meetingId: string | null) {
  const queryClient = useQueryClient()
  const supabase = useMemo(() => createClient(), [])
  const queryKey = useMemo(() => ['docInsertions', 'mine', 'meeting', meetingId] as const, [meetingId])
  const topic = meetingId ? `meeting-minutes-view:${meetingId}` : null

  const { data } = useQuery({
    queryKey,
    queryFn: () => fetchDocInsertions(supabase, { meetingId: meetingId as string }, ['pending', 'applied', 'remove_requested']),
    enabled: meetingId != null,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  })

  useEffect(() => {
    if (!topic) return
    const refetch = () => void queryClient.invalidateQueries({ queryKey })
    const offChanged = onDocSignal(topic, 'insertion-changed', refetch)
    const offSaved = onDocSignal(topic, 'minutes-saved', refetch)
    return () => {
      offChanged()
      offSaved()
    }
  }, [topic, queryClient, queryKey])

  const create = useCallback(
    async (kind: DocInsertionKind, content: string, anchor: string | null) => {
      if (!meetingId || !topic) return
      await createDocInsertion(supabase, { source: { meetingId }, kind, content, anchor })
      sendDocSignal(topic, 'insertion-changed')
      await queryClient.invalidateQueries({ queryKey })
    },
    [meetingId, topic, supabase, queryClient, queryKey]
  )

  const withdraw = useCallback(
    async (id: string) => {
      if (!topic) return
      await withdrawDocInsertion(supabase, id)
      sendDocSignal(topic, 'insertion-changed')
      await queryClient.invalidateQueries({ queryKey })
    },
    [topic, supabase, queryClient, queryKey]
  )

  return { rows: data ?? EMPTY, create, withdraw }
}
