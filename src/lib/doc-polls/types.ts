/**
 * 投票ブロックの型（DB の doc_polls / doc_votes / doc_vote_events と対）。
 * 仕様: docs/spec/DOC_VOTE_SPEC.md
 */

/** OK / NG / 保留 */
export type DocVoteChoice = 'ok' | 'ng' | 'hold'

/** none = 理由は任意（/vote）/ ng_hold = NG と保留は理由必須（/votemust） */
export type DocPollReasonRequired = 'none' | 'ng_hold'

export interface DocPoll {
  id: string
  org_id: string
  space_id: string
  wiki_page_id: string | null
  meeting_id: string | null
  reason_required: DocPollReasonRequired
  created_by: string | null
  created_at: string
}

/** 今の票（1人1行） */
export interface DocVote {
  poll_id: string
  user_id: string
  choice: DocVoteChoice
  memo: string
  created_at: string
  updated_at: string
}

/** 票の履歴（追記だけ）。cast = 初めて押した / change = 選び直した・メモを直した / retract = 取り消した */
export interface DocVoteEvent {
  id: number
  poll_id: string
  user_id: string
  action: 'cast' | 'change' | 'retract'
  choice: DocVoteChoice | null
  memo: string
  created_at: string
}

/** 投票1つぶんの、画面が使う形 */
export interface DocPollState {
  poll: DocPoll
  votes: DocVote[]
  events: DocVoteEvent[]
}

/** どの文書の投票か（片方だけ） */
export type DocPollSource = { wikiPageId: string; meetingId?: never } | { meetingId: string; wikiPageId?: never }
