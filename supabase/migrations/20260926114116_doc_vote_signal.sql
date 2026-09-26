-- =============================================================================
-- 投票の「票が変わった」合図のチャネル（DOC_VOTE_SPEC §6）
--
-- 目的: 議事録・Wiki の投票ブロックで誰かが押したら、同じ文書を開いているほかの人の画面にすぐ出す。
--   本番の Realtime は表の変化を配らない（publication は表0件）ので、押した画面が合図だけを送り、
--   受け取った画面が表の RLS 越しに票を読み直す。合図は本文も票も運ばない。
--
-- チャネル（private・broadcast だけ）:
--   meeting-minutes-view:<会議ID>   議事録
--   wiki-page-view:<ページID>       Wiki
--   同時編集のチャネル meeting-minutes:<会議ID> とは別。あちらは書ける人だけの部屋で、
--   ここは投票を押せる人（読むだけの社内メンバーを含む）も入る。
--
-- 入れる人: その文書の投票を読める人 = space の社内メンバー（app_is_space_internal。
--   app_can_read_doc_poll と同じ条件）で、二要素認証の条件（mfa_satisfied）を満たす人。
--   相手先・別組織・未ログインは入れない。相手先はポータルで押せるようにする PR（§7 の 3・4）で足す。
--   偽の合図を送られても、起きるのは「読み直し」だけ。見える範囲は表の RLS が決める。
--
-- 触るもの: 判定関数1本の新設と realtime.messages のポリシー2本の新設だけ。既存の在席・同時編集の
--   ポリシー（meeting_minutes_presence_*）と publication には触らない。
-- ロック: create policy が realtime.messages を一瞬だけ access exclusive で押さえる。トリガーは作らない。
-- 冪等: create or replace function、drop policy if exists → create policy。
-- 戻し方: 末尾のコメントの3文。戻すと画面は今までどおりの読み直し（開き直し・議事録は5秒ごと）に落ちる。
-- =============================================================================

set local lock_timeout = '3s';

create or replace function public.app_can_join_doc_vote_signal(p_topic text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
           -- 形が合うときだけ uuid に変える（合わなければ変えずに false）
           when p_topic ~ '^meeting-minutes-view:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
             exists (
               select 1
                 from public.meetings m
                where m.id = substr(p_topic, length('meeting-minutes-view:') + 1)::uuid
                  and public.app_is_space_internal(m.space_id, m.org_id)
             )
             and public.mfa_satisfied()
           when p_topic ~ '^wiki-page-view:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
             exists (
               select 1
                 from public.wiki_pages w
                where w.id = substr(p_topic, length('wiki-page-view:') + 1)::uuid
                  and w.space_id is not null
                  and public.app_is_space_internal(w.space_id, w.org_id)
             )
             and public.mfa_satisfied()
           else false
         end;
$$;

comment on function public.app_can_join_doc_vote_signal(text) is
  '投票の合図のチャネル（meeting-minutes-view:<会議ID> / wiki-page-view:<ページID>）に入れるか。投票を読める社内メンバー＋二要素認証の条件。DOC_VOTE_SPEC §6';

revoke all on function public.app_can_join_doc_vote_signal(text) from public, anon, authenticated;
grant execute on function public.app_can_join_doc_vote_signal(text) to authenticated;

drop policy if exists doc_vote_signal_select on realtime.messages;
create policy doc_vote_signal_select on realtime.messages
  for select to authenticated
  using (
    extension = 'broadcast'
    and (select public.app_can_join_doc_vote_signal(realtime.topic()))
  );

drop policy if exists doc_vote_signal_insert on realtime.messages;
create policy doc_vote_signal_insert on realtime.messages
  for insert to authenticated
  with check (
    extension = 'broadcast'
    and (select public.app_can_join_doc_vote_signal(realtime.topic()))
  );

-- 戻し方:
--   drop policy if exists doc_vote_signal_select on realtime.messages;
--   drop policy if exists doc_vote_signal_insert on realtime.messages;
--   drop function if exists public.app_can_join_doc_vote_signal(text);
