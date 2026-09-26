'use client'

import { createContext, useCallback, useContext } from 'react'
import { createReactBlockSpec } from '@blocknote/react'
import { DOC_POLL_TYPE } from '@/lib/doc-polls/logic'
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

function DocPollBlock({
  pollId,
  reasonRequired,
  contentRef,
}: {
  pollId: string
  reasonRequired: DocPollReasonRequired
  contentRef: (node: HTMLElement | null) => void
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
    />
  )
}

/**
 * 投票ブロック。本文（Wiki の JSON）には投票の番号と理由必須の設定だけを持ち、票は DB に置く
 * （DOC_VOTE_SPEC §3）。議題は普通の文字（inline）で、空でもよい。
 */
export const docPollSpec = createReactBlockSpec(
  {
    type: DOC_POLL_TYPE,
    propSchema: {
      pollId: { default: '' },
      reasonRequired: { default: 'none' as DocPollReasonRequired, values: ['none', 'ng_hold'] as const },
    },
    content: 'inline',
  } as const,
  {
    render: (props) => (
      <DocPollBlock
        pollId={props.block.props.pollId}
        reasonRequired={props.block.props.reasonRequired as DocPollReasonRequired}
        contentRef={props.contentRef}
      />
    ),
  }
)() // createReactBlockSpec が返すのは「作る関数」。1回呼んで仕様そのものにする
