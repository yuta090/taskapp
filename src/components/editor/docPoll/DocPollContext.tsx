'use client'

/**
 * 投票ブロックの中身（エディタに依らない部分）。エディタを読み込まない画面（相手先ポータルの議事録）も
 * これだけを読み込めば投票を描ける。エディタに組み込む仕様は docPollBlock.tsx。
 */
import { createContext, useCallback, useContext, type ReactNode } from 'react'
import type { DocPollReasonRequired, DocPollState, DocVoteChoice } from '@/lib/doc-polls/types'
import { DocPollView, type DocPollStatus } from './DocPollView'

/**
 * 投票ブロックが見る、その文書の投票と押し方。`DocPollHost` が本文の外側で配る。
 * 無い画面（相手先ポータルの Wiki など）では、ブロックは「この画面では投票できません」と出す。
 */
export interface DocPollContextValue {
  polls: Record<string, DocPollState>
  isFetched: boolean
  currentUserId: string | null
  nameOf: (userId: string) => string
  castVote: (args: { pollId: string; userId: string; choice: DocVoteChoice | null; memo: string }) => Promise<void>
  /** 見つからない投票を、この人が開いたときに作り直せるか（本文を編集できる人） */
  canCreate: boolean
  /** 見えない・押せない投票に出す言葉（相手先ポータルは「この投票は終了しました」） */
  closedNote?: string
  /** 作れなかった投票の番号（ブロックに案内を出す） */
  failedIds: ReadonlySet<string>
}

export const DocPollContext = createContext<DocPollContextValue | null>(null)

function statusOf(ctx: DocPollContextValue | null, state: DocPollState | undefined, pollId: string): DocPollStatus {
  if (!ctx) return 'unavailable'
  if (state) return 'ready'
  if (ctx.failedIds.has(pollId)) return 'failed'
  if (!ctx.isFetched) return 'loading'
  // 置いた直後・貼った直後は、この人の画面が作りに行く（DocPollHost）
  return ctx.canCreate ? 'preparing' : 'missing'
}

/**
 * 投票ブロック1つ。エディタの中（contentRef で議題を入れる）でも、エディタを使わず本文を
 * 自前で描く画面（相手先ポータルの議事録。title で議題を渡す）でも使う。
 */
export function DocPollBlock({
  pollId,
  reasonRequired,
  contentRef,
  title,
}: {
  pollId: string
  reasonRequired: DocPollReasonRequired
  contentRef?: (node: HTMLElement | null) => void
  title?: ReactNode
}) {
  const ctx = useContext(DocPollContext)
  const state = pollId ? ctx?.polls[pollId] : undefined
  const onCast = useCallback(
    async (choice: DocVoteChoice | null, memo: string) => {
      if (!ctx?.currentUserId) return
      await ctx.castVote({ pollId, userId: ctx.currentUserId, choice, memo })
    },
    [ctx, pollId]
  )
  return (
    <DocPollView
      reasonRequired={reasonRequired}
      state={state}
      status={statusOf(ctx, state, pollId)}
      currentUserId={ctx?.currentUserId ?? null}
      nameOf={ctx?.nameOf ?? (() => '')}
      onCast={onCast}
      contentRef={contentRef}
      title={title}
      closedNote={ctx?.closedNote}
    />
  )
}

