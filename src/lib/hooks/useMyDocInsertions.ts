'use client'

import { useCallback, useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { createDocInsertion, fetchDocInsertions, withdrawDocInsertion, type DocInsertionSource } from '@/lib/doc-insertions/api'
import type { DocInsertion, DocInsertionKind } from '@/lib/doc-insertions/logic'
import { onDocSignal, sendDocSignal } from '@/lib/hooks/useDocVoteSignal'

const EMPTY: DocInsertion[] = []

/**
 * 相手先ポータルの議事録・Wiki で、自分の差し込み（反映待ち・反映済み・削除依頼）を持つ（DOC_VOTE_SPEC §5）。
 * 作る・取り下げるのたびに、同じ議事録を開いている社内の画面へ「差し込みが変わった」と知らせる
 * （社内の編集画面がすぐ取り込む）。社内が反映した・保存したの知らせで読み直す。
 */
export function useMyDocInsertions(target: string | DocInsertionSource | null) {
  const queryClient = useQueryClient()
  const supabase = useMemo(() => createClient(), [])
  // 文字列は会議の id（議事録）として受ける（これまでの呼び方）
  const isWiki = target != null && typeof target !== 'string' && target.wikiPageId != null
  const docId = target == null ? null : typeof target === 'string' ? target : ((target.wikiPageId ?? target.meetingId) as string)
  const source = useMemo<DocInsertionSource | null>(
    () => (docId == null ? null : isWiki ? { wikiPageId: docId } : { meetingId: docId }),
    [docId, isWiki]
  )
  const queryKey = useMemo(() => ['docInsertions', 'mine', isWiki ? 'wiki' : 'meeting', docId] as const, [isWiki, docId])
  const topic = docId == null ? null : isWiki ? `wiki-page-view:${docId}` : `meeting-minutes-view:${docId}`

  const { data } = useQuery({
    queryKey,
    queryFn: () => fetchDocInsertions(supabase, source as DocInsertionSource, ['pending', 'applied', 'remove_requested']),
    enabled: source != null,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  })

  useEffect(() => {
    if (!topic) return
    // 社内が反映した・消したときは社内の画面が insertion-changed を送る。保存のたびには読み直さない
    // （会議中は数秒ごとに保存されるので、見ている相手先の人数分の読み込みになる）
    return onDocSignal(topic, 'insertion-changed', () => void queryClient.invalidateQueries({ queryKey }))
  }, [topic, queryClient, queryKey])

  const create = useCallback(
    async (kind: DocInsertionKind, content: string, anchor: string | null) => {
      if (!source || !topic) return
      await createDocInsertion(supabase, { source, kind, content, anchor })
      sendDocSignal(topic, 'insertion-changed')
      await queryClient.invalidateQueries({ queryKey })
    },
    [source, topic, supabase, queryClient, queryKey]
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

  /** 読み直す（知らせが届かなかったときの保険。本文が変わったのを見て呼ぶ） */
  const refresh = useCallback(() => queryClient.invalidateQueries({ queryKey }), [queryClient, queryKey])

  return { rows: data ?? EMPTY, create, withdraw, refresh }
}
