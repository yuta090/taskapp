'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { castDocVote, createDocPoll, fetchDocPolls } from '@/lib/doc-polls/api'
import { applyOptimisticVote } from '@/lib/doc-polls/logic'
import { useDocVoteSignal } from '@/lib/hooks/useDocVoteSignal'
import type { DocPollReasonRequired, DocPollSource, DocPollState, DocVoteChoice } from '@/lib/doc-polls/types'

/** 投票の読み込みのキー。先読み（usePrefetchDocPolls）と本体で同じものを使う */
export function docPollsQueryKey(source: DocPollSource | null) {
  const kind = source?.wikiPageId ? 'wiki' : 'meeting'
  const docId = source?.wikiPageId ?? source?.meetingId ?? null
  return ['docPolls', kind, docId] as const
}

const STALE_TIME = 15_000
/** 議事録で合図のチャネルにつながらないときの読み直しの間隔（会議中に皆で押すので短く） */
const MEETING_REFETCH_MS = 5_000
/** 議事録で合図が届いている間の、取りこぼし用の読み直しの間隔 */
const CONNECTED_REFETCH_MS = 60_000
/**
 * 合図を受けてから読み直すまでの待ち。続けて届いた合図は最後の1回にまとめる
 * （20人が同時に押すと各画面に19回届き、1回ずつ読み直すと全体で人数の2乗の取得になる）
 */
const SIGNAL_DEBOUNCE_MS = 400

/**
 * 投票を先に読み始める。投票に要るのは文書の番号だけなので、本文やエディタの読み込みを
 * 待たずに URL の番号で取りに行く（待つと、本文が出たあとに投票だけ1往復遅れて出る）。
 * 結果は購読しない（押された票で画面全体が描き直されないように）。
 */
export function usePrefetchDocPolls(source: DocPollSource | null) {
  const queryClient = useQueryClient()
  const [, kind, docId] = docPollsQueryKey(source)
  useEffect(() => {
    if (!docId) return
    const src: DocPollSource = kind === 'wiki' ? { wikiPageId: docId } : { meetingId: docId }
    void queryClient.prefetchQuery({
      queryKey: docPollsQueryKey(src),
      queryFn: () => fetchDocPolls(createClient(), src),
      staleTime: STALE_TIME,
    })
  }, [queryClient, kind, docId])
}

// 読み込み中に毎回新しい {} を作ると、使う側の useMemo が毎回無効になるため共有の定数にする
const EMPTY: Record<string, DocPollState> = {}

/**
 * 文書（Wiki ページ・議事録）の投票を、票と履歴ごとまとめて持つ。
 * 1ページ1回の読み込みで、中の投票ブロックはみなこれを見る（ブロックごとに読みに行かない）。
 *
 * ほかの人の票は、ほかの人が押したときの合図（useDocVoteSignal）を受けて読み直し、すぐ出す。
 * 合図のチャネルにつながらないときは、開いたとき・画面に戻ったとき・自分が押したあと
 * （議事録はさらに5秒ごと）に読み直す。
 */
export function useDocPolls(source: DocPollSource | null) {
  const queryClient = useQueryClient()
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  const [, kind, docId] = docPollsQueryKey(source)
  const queryKey = useMemo(() => ['docPolls', kind, docId] as const, [kind, docId])
  // 呼ぶ側が毎回新しい source を作っても、番号が同じなら同じものを使う（関数を作り直さない）
  const stableSource = useMemo<DocPollSource | null>(
    () => (docId == null ? null : kind === 'wiki' ? { wikiPageId: docId } : { meetingId: docId }),
    [kind, docId]
  )

  // 投票ごとの「送っている途中の列」と、最後に押した回。押し直しを押した順に1本ずつ送るために持つ
  const chainsRef = useRef(new Map<string, Promise<void>>())
  const seqRef = useRef(new Map<string, number>())

  // ほかの人が押した合図。自分の送信の途中は読み直さない（まだ届いていない押し直しが画面から
  // 一瞬消える）。送り終えたときの読み直しで、ほかの人の票も一緒に入る
  const signalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleSignal = useCallback(() => {
    if (signalTimerRef.current) clearTimeout(signalTimerRef.current)
    signalTimerRef.current = setTimeout(() => {
      signalTimerRef.current = null
      if (chainsRef.current.size > 0) return
      // 読み込み中の取得があればそれを使う（打ち切って出し直さない）
      void queryClient.invalidateQueries({ queryKey }, { cancelRefetch: false })
    }, SIGNAL_DEBOUNCE_MS)
  }, [queryClient, queryKey])
  useEffect(
    () => () => {
      if (signalTimerRef.current) clearTimeout(signalTimerRef.current)
    },
    [queryKey]
  )
  const { connected, notify } = useDocVoteSignal(stableSource, handleSignal)

  const { data, isFetched } = useQuery({
    queryKey,
    queryFn: () => fetchDocPolls(supabase, stableSource as DocPollSource),
    enabled: docId != null,
    staleTime: STALE_TIME,
    refetchOnWindowFocus: true,
    // 議事録は会議中に皆で押すので定期にも読み直す。合図が届いている間は取りこぼし用に60秒ごと、
    // つながらないときは5秒ごと（画面が裏にある間は止まる）。Wiki は合図と開き直しだけで足りる
    refetchInterval: kind !== 'meeting' ? false : connected ? CONNECTED_REFETCH_MS : MEETING_REFETCH_MS,
  })

  /**
   * 押す・選び直す・取り消す（choice = null）。画面は先に変え、送信は同じ投票について1本ずつ順に送る
   * （並べて送ると届く順番が決まらず、画面が最後に見せた選択と DB に残る選択がずれる）。
   * 読み直しと、失敗したときの巻き戻しは、最後に押した回だけが行う（途中で読み直すと、
   * まだ届いていない押し直しが画面から一瞬消える）。
   */
  const castVote = useCallback(
    async (args: { pollId: string; userId: string; choice: DocVoteChoice | null; memo: string }) => {
      const seq = (seqRef.current.get(args.pollId) ?? 0) + 1
      seqRef.current.set(args.pollId, seq)
      const isLatest = () => seqRef.current.get(args.pollId) === seq

      await queryClient.cancelQueries({ queryKey })
      const prev = queryClient.getQueryData<Record<string, DocPollState>>(queryKey)
      if (prev) {
        queryClient.setQueryData(queryKey, applyOptimisticVote(prev, args, new Date().toISOString()))
      }

      const before = chainsRef.current.get(args.pollId) ?? Promise.resolve()
      const run = before
        .catch(() => {})
        .then(() => castDocVote(supabase, { pollId: args.pollId, choice: args.choice, memo: args.memo }))
      chainsRef.current.set(args.pollId, run)
      try {
        await run
        if (isLatest()) notify()
      } catch (e) {
        if (prev && isLatest()) queryClient.setQueryData(queryKey, prev)
        throw e
      } finally {
        if (chainsRef.current.get(args.pollId) === run) chainsRef.current.delete(args.pollId)
        // 履歴と、ほかの人の票を取り直す
        if (isLatest()) void queryClient.invalidateQueries({ queryKey })
      }
    },
    [queryClient, queryKey, supabase, notify]
  )

  /** 投票を作る（番号は呼ぶ側が作って本文に置いたもの） */
  const createPoll = useCallback(
    async (pollId: string, reasonRequired: DocPollReasonRequired) => {
      if (!stableSource) return
      await createDocPoll(supabase, { pollId, source: stableSource, reasonRequired })
      notify()
      await queryClient.invalidateQueries({ queryKey })
    },
    [queryClient, queryKey, stableSource, supabase, notify]
  )

  return { polls: data ?? EMPTY, isFetched, castVote, createPoll }
}
