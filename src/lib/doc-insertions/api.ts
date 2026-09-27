/**
 * 相手先の差し込みの読み書き。書き込みは DB の関数（rpc_doc_insertion_*）だけ（DOC_VOTE_SPEC §5.1）。
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { DocInsertion, DocInsertionKind, DocInsertionStatus } from './logic'

const COLUMNS =
  'id, org_id, space_id, wiki_page_id, meeting_id, kind, content, anchor, status, anchor_missed, author_id, author_name, created_at'

export type DocInsertionSource = { meetingId: string; wikiPageId?: never } | { wikiPageId: string; meetingId?: never }

/** その文書の差し込みを読む（社内は全部、相手先は自分の分だけが RLS で返る）。古い順 */
export async function fetchDocInsertions(
  supabase: SupabaseClient,
  source: DocInsertionSource,
  statuses: DocInsertionStatus[]
): Promise<DocInsertion[]> {
  const [column, value] = source.meetingId ? (['meeting_id', source.meetingId] as const) : (['wiki_page_id', source.wikiPageId as string] as const)
  const { data, error } = await supabase
    .from('doc_insertions')
    .select(COLUMNS)
    .eq(column, value)
    .in('status', statuses)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as DocInsertion[]
}

/** 取り込みで読む取り消しの期間。取り込んだあと保存する前に取り消された行を消すためだけに読む */
const RECENT_WITHDRAWN_MS = 10 * 60_000

/**
 * 社内の取り込みが読む分: 反映待ち・削除依頼と、最近（10分）取り消された分。
 * 取り消しは消えずに増えるので全部読むと、長く使う文書ほど読み込みと見直しが重くなる
 */
export async function fetchInsertionsToSync(
  supabase: SupabaseClient,
  source: DocInsertionSource,
  now: Date = new Date()
): Promise<DocInsertion[]> {
  const [column, value] = source.meetingId ? (['meeting_id', source.meetingId] as const) : (['wiki_page_id', source.wikiPageId as string] as const)
  // 時刻の比較だけに使う（日付の文字列にはしない）
  const since = new Date(now.getTime() - RECENT_WITHDRAWN_MS).toISOString()
  const { data, error } = await supabase
    .from('doc_insertions')
    .select(COLUMNS)
    .eq(column, value)
    .or(`status.in.(pending,remove_requested),and(status.eq.withdrawn,closed_at.gt.${since})`)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as DocInsertion[]
}

export async function createDocInsertion(
  supabase: SupabaseClient,
  args: { source: DocInsertionSource; kind: DocInsertionKind; content: string; anchor: string | null }
): Promise<string> {
  const { data, error } = await supabase.rpc('rpc_doc_insertion_create', {
    p_wiki_page_id: args.source.wikiPageId ?? null,
    p_meeting_id: args.source.meetingId ?? null,
    p_kind: args.kind,
    p_content: args.content,
    p_anchor: args.anchor,
  })
  if (error) throw error
  return data as string
}

export async function withdrawDocInsertion(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.rpc('rpc_doc_insertion_withdraw', { p_id: id })
  if (error) throw error
}

/** 反映済みにする。本文に目印がまだ無い（保存前）なら DB が not_in_body で断る */
export async function markDocInsertionApplied(supabase: SupabaseClient, id: string, anchorMissed: boolean): Promise<void> {
  const { error } = await supabase.rpc('rpc_doc_insertion_mark_applied', { p_id: id, p_anchor_missed: anchorMissed })
  if (error) throw error
}

/** 削除済みにする。本文に目印がまだ残っている（保存前）なら DB が still_in_body で断る */
export async function markDocInsertionRemoved(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.rpc('rpc_doc_insertion_mark_removed', { p_id: id })
  if (error) throw error
}

/** 本文に取り込む権利を取る（1件ごと・2分）。取れたら true。本文にもう入っていれば DB が反映済みにして false */
export async function claimDocInsertion(supabase: SupabaseClient, id: string, tab: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('rpc_doc_insertion_claim', { p_id: id, p_tab: tab })
  if (error) throw error
  return data === true
}

/** 取り込んだ行を社内が保存の前に消した（採らなかった）ので閉じる。本文にまだあれば DB が断る */
export async function dismissDocInsertion(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.rpc('rpc_doc_insertion_dismiss', { p_id: id })
  if (error) throw error
}
