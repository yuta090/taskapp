import { z } from 'zod';
import { getSupabaseClient } from '../supabase/client.js';
import { checkAuth } from '../auth/helpers.js';
import { ToolUserError } from '../errors.js';
import { assertInSpace, requireActorUserId } from '../auth/scope.js';
/**
 * 投票ブロック（Wiki・議事録）の一覧・詳細・押す/選び直す/取り消す。
 * 仕様: docs/spec/DOC_VOTE_SPEC.md。書き込みは rpc_doc_vote_cast_as（20260926133744_doc_vote_cast_as.sql）だけ。
 * 読み（list/show）は service role がそのまま表を読む（他ツールと同じ形。PR1 は社内だけが読める投票）。
 */
async function getOrgId(spaceId) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.from('spaces').select('org_id').eq('id', spaceId).single();
    if (error || !data)
        throw new Error('スペースが見つかりません');
    return data.org_id;
}
// 本文（BlockNote）での投票ブロックの型名。Wiki の JSON に残るので変えない（DOC_VOTE_SPEC §3.1）
const DOC_POLL_TYPE = 'docPoll';
// BlockNote の inline content（text / link の入れ子）から文字だけを拾う
function inlineText(content) {
    if (!Array.isArray(content))
        return '';
    return content
        .map((node) => {
        const n = node;
        if (typeof n?.text === 'string')
            return n.text;
        if (n?.content)
            return inlineText(n.content);
        return '';
    })
        .join('');
}
/** Wiki 本文（BlockNote JSON）から、投票の議題・理由必須を pollId ごとに拾う */
function findWikiPollTopics(body) {
    const out = new Map();
    const walk = (blocks) => {
        if (!Array.isArray(blocks))
            return;
        for (const raw of blocks) {
            const b = raw;
            if (b?.type === DOC_POLL_TYPE) {
                const pollId = typeof b.props?.pollId === 'string' ? b.props.pollId : '';
                const reasonRequired = b.props?.reasonRequired === 'ng_hold' ? 'ng_hold' : 'none';
                if (pollId)
                    out.set(pollId, { topic: inlineText(b.content), reasonRequired });
            }
            if (Array.isArray(b?.children))
                walk(b.children);
        }
    };
    walk(body);
    return out;
}
// 議事録（Markdown）の投票行 `<!--vote:uuid-->議題` / `<!--vote:uuid must-->議題`（DOC_VOTE_SPEC §3.2。形は変えない）
const MEETING_VOTE_LINE_RE = /^<!--vote:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})( must)?-->(.*)$/gm;
/** 議事録の本文（Markdown）から、投票の議題・理由必須を pollId ごとに拾う */
function findMeetingPollTopics(minutesMd) {
    const out = new Map();
    for (const m of minutesMd.matchAll(MEETING_VOTE_LINE_RE)) {
        out.set(m[1], { topic: m[3].trim(), reasonRequired: m[2] ? 'ng_hold' : 'none' });
    }
    return out;
}
async function displayNamesOf(supabase, userIds) {
    const uniqueIds = Array.from(new Set(userIds));
    if (uniqueIds.length === 0)
        return new Map();
    const { data } = await supabase.from('profiles').select('id, display_name').in('id', uniqueIds);
    const out = new Map();
    for (const p of (data || [])) {
        out.set(p.id, p.display_name || '(名前未設定)');
    }
    return out;
}
// Schemas
export const voteListSchema = z.object({
    spaceId: z.string().uuid().describe('スペースUUID（必須）'),
    wikiPageId: z.string().uuid().optional().describe('WikiページUUID。meetingIdとどちらか片方だけ指定'),
    meetingId: z.string().uuid().optional().describe('会議UUID。wikiPageIdとどちらか片方だけ指定'),
});
export const voteShowSchema = z.object({
    spaceId: z.string().uuid().describe('スペースUUID（必須）'),
    pollId: z.string().uuid().describe('投票UUID'),
});
export const voteCastSchema = z.object({
    spaceId: z.string().uuid().describe('スペースUUID（必須）'),
    pollId: z.string().uuid().describe('投票UUID'),
    choice: z.enum(['ok', 'ng', 'hold', 'none']).describe('選ぶもの。none で取り消し'),
    memo: z.string().max(2000).optional().describe('理由のメモ（NG・保留かつ理由必須の投票では必須）'),
});
export async function voteList(params) {
    await checkAuth(params.spaceId, 'read', 'vote_list', 'doc_poll');
    const hasWiki = !!params.wikiPageId;
    const hasMeeting = !!params.meetingId;
    if (hasWiki === hasMeeting) {
        throw new ToolUserError('wikiPageId と meetingId は、どちらか片方だけ指定してください', 400);
    }
    const supabase = getSupabaseClient();
    const orgId = await getOrgId(params.spaceId);
    let topics;
    let pollFilterColumn;
    let pollFilterValue;
    if (hasWiki) {
        await assertInSpace('wiki_pages', params.wikiPageId, params.spaceId, 'Wikiページが見つかりません');
        const { data, error } = await supabase.from('wiki_pages').select('body').eq('id', params.wikiPageId).single();
        if (error || !data)
            throw new Error('Wikiページが見つかりません');
        topics = findWikiPollTopics(data.body);
        pollFilterColumn = 'wiki_page_id';
        pollFilterValue = params.wikiPageId;
    }
    else {
        await assertInSpace('meetings', params.meetingId, params.spaceId, '会議が見つかりません');
        const { data, error } = await supabase.from('meetings').select('minutes_md').eq('id', params.meetingId).single();
        if (error || !data)
            throw new Error('会議が見つかりません');
        topics = findMeetingPollTopics(data.minutes_md || '');
        pollFilterColumn = 'meeting_id';
        pollFilterValue = params.meetingId;
    }
    const { data: polls, error: pollsError } = await supabase
        .from('doc_polls')
        .select('id, reason_required')
        .eq('org_id', orgId)
        .eq('space_id', params.spaceId)
        .eq(pollFilterColumn, pollFilterValue)
        .order('created_at', { ascending: true });
    if (pollsError)
        throw new Error('投票の取得に失敗しました');
    const pollRows = (polls || []);
    if (pollRows.length === 0)
        return [];
    const pollIds = pollRows.map((p) => p.id);
    const { data: votes, error: votesError } = await supabase.from('doc_votes').select('poll_id, choice').in('poll_id', pollIds);
    if (votesError)
        throw new Error('票の取得に失敗しました');
    const counts = new Map();
    for (const id of pollIds)
        counts.set(id, { ok: 0, ng: 0, hold: 0 });
    for (const v of (votes || [])) {
        const c = counts.get(v.poll_id);
        if (c)
            c[v.choice] += 1;
    }
    return pollRows.map((p) => ({
        pollId: p.id,
        topic: topics.get(p.id)?.topic ?? '',
        reasonRequired: p.reason_required,
        counts: counts.get(p.id) || { ok: 0, ng: 0, hold: 0 },
    }));
}
export async function voteShow(params) {
    await checkAuth(params.spaceId, 'read', 'vote_show', 'doc_poll', params.pollId);
    await assertInSpace('doc_polls', params.pollId, params.spaceId, '投票が見つかりません');
    const supabase = getSupabaseClient();
    const { data: poll, error: pollError } = await supabase
        .from('doc_polls')
        .select('id, reason_required')
        .eq('id', params.pollId)
        .eq('space_id', params.spaceId)
        .single();
    if (pollError || !poll)
        throw new Error('投票が見つかりません');
    const { data: votes, error: votesError } = await supabase
        .from('doc_votes')
        .select('user_id, choice, memo, updated_at')
        .eq('poll_id', params.pollId)
        .order('updated_at', { ascending: true });
    if (votesError)
        throw new Error('票の取得に失敗しました');
    const { data: events, error: eventsError } = await supabase
        .from('doc_vote_events')
        .select('id, user_id, action, choice, memo, created_at')
        .eq('poll_id', params.pollId)
        .order('id', { ascending: true });
    if (eventsError)
        throw new Error('履歴の取得に失敗しました');
    const voteRows = (votes || []);
    const eventRows = (events || []);
    const nameByUser = await displayNamesOf(supabase, [...voteRows.map((v) => v.user_id), ...eventRows.map((e) => e.user_id)]);
    return {
        pollId: poll.id,
        reasonRequired: poll.reason_required,
        votes: voteRows.map((v) => ({
            userId: v.user_id,
            displayName: nameByUser.get(v.user_id) ?? '(不明)',
            choice: v.choice,
            memo: v.memo,
            updatedAt: v.updated_at,
        })),
        history: eventRows.map((e) => ({
            userId: e.user_id,
            displayName: nameByUser.get(e.user_id) ?? '(不明)',
            action: e.action,
            choice: e.choice,
            memo: e.memo,
            createdAt: e.created_at,
        })),
    };
}
// rpc_doc_vote_cast_as が RAISE EXCEPTION で返す理由を、決まった日本語の ToolUserError に置き換える
function mapVoteCastError(error) {
    if (error.message === 'reason_required')
        return new ToolUserError('NG と保留は理由を書いてください', 400);
    if (error.message === 'memo_too_long')
        return new ToolUserError('メモは2000字までです', 400);
    if (error.message === 'invalid_choice')
        return new ToolUserError('choiceは ok / ng / hold / none のいずれかにしてください', 400);
    if (error.code === '42501')
        return new ToolUserError('この投票には押せません', 403);
    return new Error('投票に失敗しました');
}
export async function voteCast(params) {
    await checkAuth(params.spaceId, 'write', 'vote_cast', 'doc_poll', params.pollId);
    await assertInSpace('doc_polls', params.pollId, params.spaceId, '投票が見つかりません');
    // 誰が押したか（doc_vote_events.user_id）は、鍵に紐づく利用者から取る
    const actor = requireActorUserId();
    const choice = params.choice === 'none' ? null : params.choice;
    const memo = params.memo ?? '';
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc('rpc_doc_vote_cast_as', {
        p_actor: actor,
        p_poll_id: params.pollId,
        p_choice: choice,
        p_memo: memo,
    });
    if (error)
        throw mapVoteCastError(error);
    return { ok: true, choice: data ?? null };
}
// Tool definitions for MCP
export const voteTools = [
    {
        name: 'vote_list',
        description: 'Wikiページ・会議の投票ブロックの一覧（議題・理由必須か・OK/NG/保留の人数）',
        inputSchema: voteListSchema,
        handler: voteList,
    },
    {
        name: 'vote_show',
        description: '投票の詳細（押した人・選んだもの・メモ・履歴）',
        inputSchema: voteShowSchema,
        handler: voteShow,
    },
    {
        name: 'vote_cast',
        description: '投票を押す・選び直す・取り消す（choice=none）',
        inputSchema: voteCastSchema,
        handler: voteCast,
    },
];
//# sourceMappingURL=votes.js.map