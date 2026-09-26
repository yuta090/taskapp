/**
 * 投票ブロックの読み書き。書き込みは DB の関数（rpc_doc_poll_create / rpc_doc_vote_cast）だけ。
 * 表へ直接は書けない（DOC_VOTE_SPEC §4）。
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  DocPoll,
  DocPollReasonRequired,
  DocPollSource,
  DocPollState,
  DocVote,
  DocVoteChoice,
  DocVoteEvent,
} from './types'

// 埋め込みは外部キー名で指す（名前を書かないと、外部キーが増えたときに本番だけ曖昧さで落ちる）
const POLL_SELECT = [
  'id, org_id, space_id, wiki_page_id, meeting_id, reason_required, created_by, created_at',
  'doc_votes!doc_votes_poll_id_fkey(poll_id, user_id, choice, memo, created_at, updated_at)',
  'doc_vote_events!doc_vote_events_poll_id_fkey(id, poll_id, user_id, action, choice, memo, created_at)',
].join(', ')

type PollRow = DocPoll & { doc_votes?: DocVote[] | null; doc_vote_events?: DocVoteEvent[] | null }

/** その文書の投票を、票と履歴ごと1回で読む。返すのは 投票の番号 → 中身 */
export async function fetchDocPolls(supabase: SupabaseClient, source: DocPollSource): Promise<Record<string, DocPollState>> {
  const [column, value] = source.wikiPageId
    ? (['wiki_page_id', source.wikiPageId] as const)
    : (['meeting_id', source.meetingId as string] as const)
  const { data, error } = await supabase.from('doc_polls').select(POLL_SELECT).eq(column, value)
  if (error) throw error
  const out: Record<string, DocPollState> = {}
  for (const row of (data ?? []) as unknown as PollRow[]) {
    const { doc_votes, doc_vote_events, ...poll } = row
    out[poll.id] = {
      poll,
      votes: doc_votes ?? [],
      events: [...(doc_vote_events ?? [])].sort((a, b) => a.id - b.id),
    }
  }
  return out
}

/** 投票を作る。同じ番号・同じ文書の再送はそのまま通る */
export async function createDocPoll(
  supabase: SupabaseClient,
  args: { pollId: string; source: DocPollSource; reasonRequired: DocPollReasonRequired }
): Promise<void> {
  const { error } = await supabase.rpc('rpc_doc_poll_create', {
    p_poll_id: args.pollId,
    p_wiki_page_id: args.source.wikiPageId ?? null,
    p_meeting_id: args.source.meetingId ?? null,
    p_reason_required: args.reasonRequired,
  })
  if (error) throw error
}

/** 押す・選び直す・取り消す（choice = null） */
export async function castDocVote(
  supabase: SupabaseClient,
  args: { pollId: string; choice: DocVoteChoice | null; memo: string }
): Promise<void> {
  const { error } = await supabase.rpc('rpc_doc_vote_cast', {
    p_poll_id: args.pollId,
    p_choice: args.choice,
    p_memo: args.memo,
  })
  if (error) throw error
}
