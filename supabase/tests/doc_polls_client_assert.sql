-- =============================================================================
-- 投票ブロック PR3: 相手先（ポータル）も読める・押せる・合図のチャネルに入れる
-- 前提: run_doc_polls_client.sh が空DBに全 migration を適用済み。
-- 仕様: docs/spec/DOC_VOTE_SPEC.md §4.2（読める人＝押せる人。文書を読める条件をそのまま写す）
--
--   議事録: 社内、または space に入れる人（app_can_access_space）で会議が 進行中・終了
--   Wiki  : 社内、または space に入れる人で、公開中のマイルストーンに公開したページ
-- =============================================================================
set client_min_messages = notice;

\set O1 '00000000-0000-4000-8000-0000000e0a01'
\set S1 '00000000-0000-4000-8000-0000000e0b01'
\set S2 '00000000-0000-4000-8000-0000000e0b02'
\set u_ed   '00000000-0000-4000-8000-0000000e0c01'
\set u_cli  '00000000-0000-4000-8000-0000000e0c02'
\set u_ven  '00000000-0000-4000-8000-0000000e0c03'
\set u_cli2 '00000000-0000-4000-8000-0000000e0c04'
\set u_mfa  '00000000-0000-4000-8000-0000000e0c05'
\set W_pub   '00000000-0000-4000-8000-0000000e0d01'
\set W_unpub '00000000-0000-4000-8000-0000000e0d02'
\set M_ended   '00000000-0000-4000-8000-0000000e0e01'
\set M_planned '00000000-0000-4000-8000-0000000e0e02'
\set MS1 '00000000-0000-4000-8000-0000000e0f01'
\set P_w  '00000000-0000-4000-8000-0000000e1001'
\set P_wu '00000000-0000-4000-8000-0000000e1002'
\set P_me '00000000-0000-4000-8000-0000000e1003'
\set P_mp '00000000-0000-4000-8000-0000000e1004'
\set P_after '00000000-0000-4000-8000-0000000e1005'
\set P_gone  '00000000-0000-4000-8000-0000000e1006'
\set O2 '00000000-0000-4000-8000-0000000e0a02'
\set S3 '00000000-0000-4000-8000-0000000e0b03'
\set u_o2cli '00000000-0000-4000-8000-0000000e0c06'

-- ---- 検証用の小道具（呼んだ人の権限で動く） ----
create schema if not exists dvt;
grant usage on schema dvt to authenticated, anon;

-- 文を実行して ok / err:<SQLSTATE>:<メッセージ> を返す。成功した分はそのまま残す
create or replace function dvt.try(q text) returns text language plpgsql as $$
begin
  execute q;
  return 'ok';
exception when others then
  return 'err:' || sqlstate || ':' || sqlerrm;
end $$;

create or replace function dvt.check(label text, got text, want text) returns void language plpgsql as $$
begin
  if got is distinct from want and not (want like '%\%%' and got like want) then
    raise exception 'FAIL[%] got=% want=%', label, got, want;
  end if;
  raise notice 'PASS[%]', label;
end $$;

-- 呼ぶ人を切り替える（auth.uid() は request.jwt.claim.sub、aal は request.jwt.claims を読む）
create or replace function dvt.as_user(p_uid text, p_aal text default '') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_uid, false);
  perform set_config('request.jwt.claims',
    case when p_aal = '' then '' else json_build_object('sub', p_uid, 'aal', p_aal)::text end, false);
end $$;

grant execute on all functions in schema dvt to authenticated, anon;

-- ---- 下ごしらえ ----
insert into auth.users(id) values (:'u_ed'), (:'u_cli'), (:'u_ven'), (:'u_cli2'), (:'u_mfa');
insert into organizations(id, name) values (:'O1', '検証org');
insert into org_memberships(org_id, user_id, role) values
  (:'O1', :'u_ed', 'member'), (:'O1', :'u_cli', 'client'), (:'O1', :'u_ven', 'client'),
  (:'O1', :'u_cli2', 'client'), (:'O1', :'u_mfa', 'client');
insert into spaces(id, org_id, type, name) values (:'S1', :'O1', 'project', 'S1'), (:'S2', :'O1', 'project', 'S2');
insert into space_memberships(space_id, user_id, role) values
  (:'S1', :'u_ed', 'editor'), (:'S1', :'u_cli', 'client'), (:'S1', :'u_ven', 'vendor'),
  (:'S2', :'u_cli2', 'client'), (:'S1', :'u_mfa', 'client');
insert into auth.mfa_factors(user_id, status) values (:'u_mfa', 'verified');
insert into wiki_pages(id, org_id, space_id, title, body, created_by, updated_by) values
  (:'W_pub', :'O1', :'S1', '公開', '[]', :'u_ed', :'u_ed'),
  (:'W_unpub', :'O1', :'S1', '未公開', '[]', :'u_ed', :'u_ed');
insert into milestones(id, org_id, space_id, name) values (:'MS1', :'O1', :'S1', '第1弾');
insert into milestone_publications(org_id, milestone_id, is_published, published_by) values (:'O1', :'MS1', true, :'u_ed');
insert into meetings(id, org_id, space_id, title, held_at, status, created_by) values
  (:'M_ended', :'O1', :'S1', '終わった会議', now(), 'ended', :'u_ed'),
  (:'M_planned', :'O1', :'S1', '予定の会議', now(), 'planned', :'u_ed');

set role authenticated;
select dvt.as_user(:'u_ed');
select dvt.check('create_w',  dvt.try(format('select rpc_doc_poll_create(%L, %L, null, %L)', :'P_w',  :'W_pub',   'ng_hold')), 'ok');
select dvt.check('create_wu', dvt.try(format('select rpc_doc_poll_create(%L, %L, null, %L)', :'P_wu', :'W_unpub', 'none')), 'ok');
select dvt.check('create_me', dvt.try(format('select rpc_doc_poll_create(%L, null, %L, %L)', :'P_me', :'M_ended',   'none')), 'ok');
select dvt.check('create_mp', dvt.try(format('select rpc_doc_poll_create(%L, null, %L, %L)', :'P_mp', :'M_planned', 'none')), 'ok');
select dvt.check('internal_votes', dvt.try(format('select rpc_doc_vote_cast(%L, %L, %L)', :'P_me', 'ok', '')), 'ok');
select dvt.check('create_gone', dvt.try(format('select rpc_doc_poll_create(%L, %L, null, %L)', :'P_gone', :'W_pub', 'none')), 'ok');

-- 公開: 控え（published_body）に載るのは P_w と P_gone。そのあと元ページから P_gone を消し、
-- 社内だけの相談として P_after を足す（控えには載っていない）
reset role;
insert into wiki_page_publications(org_id, milestone_id, source_page_id, published_title, published_body, published_by)
  values (:'O1', :'MS1', :'W_pub', '公開',
          format('[{"type":"docPoll","props":{"pollId":"%s"}},{"type":"docPoll","props":{"pollId":"%s"}}]', :'P_w', :'P_gone'),
          :'u_ed');
set role authenticated;
select dvt.as_user(:'u_ed');
select dvt.check('create_after', dvt.try(format('select rpc_doc_poll_create(%L, %L, null, %L)', :'P_after', :'W_pub', 'none')), 'ok');
select dvt.check('internal_votes_after', dvt.try(format('select rpc_doc_vote_cast(%L, %L, %L)', :'P_after', 'ng', '社内だけの話: 断る')), 'ok');
reset role;
update wiki_pages set body = format('[{"type":"docPoll","props":{"pollId":"%s"}},{"type":"docPoll","props":{"pollId":"%s"}}]', :'P_w', :'P_after')
 where id = :'W_pub';
set role authenticated;

-- ---- 相手先（client）: 読める文書の投票だけ読めて押せる ----
select dvt.as_user(:'u_cli');
select dvt.check('client_reads',
  (select string_agg(id::text, ',' order by id) from doc_polls), :'P_w' || ',' || :'P_me');
-- 公開のあとに足した投票（控えに無い）は、名前もメモも読めず押せない
select dvt.check('client_no_after_votes', (select count(*)::text from doc_votes where poll_id = :'P_after'), '0');
select dvt.check('client_no_after_events', (select count(*)::text from doc_vote_events where poll_id = :'P_after'), '0');
select dvt.check('client_votes_after', dvt.try(format('select rpc_doc_vote_cast(%L, %L, %L)', :'P_after', 'ok', '')), 'err:42501:%');
-- 公開のあとに元ページから消した投票（控えには残っている）は押せない（社内には見えなくなっているため）
select dvt.check('client_votes_gone', dvt.try(format('select rpc_doc_vote_cast(%L, %L, %L)', :'P_gone', 'ok', '')), 'err:42501:%');
select dvt.check('client_sees_internal_vote', (select count(*)::text from doc_votes where poll_id = :'P_me'), '1');
select dvt.check('client_votes_meeting', dvt.try(format('select rpc_doc_vote_cast(%L, %L, %L)', :'P_me', 'hold', '')), 'ok');
select dvt.check('client_votes_wiki_reason', dvt.try(format('select rpc_doc_vote_cast(%L, %L, %L)', :'P_w', 'ng', '')), 'err:22023:reason_required');
select dvt.check('client_votes_wiki', dvt.try(format('select rpc_doc_vote_cast(%L, %L, %L)', :'P_w', 'ng', E'高い\n来月なら')), 'ok');
select dvt.check('client_votes_unpub', dvt.try(format('select rpc_doc_vote_cast(%L, %L, %L)', :'P_wu', 'ok', '')), 'err:42501:%');
select dvt.check('client_votes_planned', dvt.try(format('select rpc_doc_vote_cast(%L, %L, %L)', :'P_mp', 'ok', '')), 'err:42501:%');
select dvt.check('client_cannot_create', dvt.try(format('select rpc_doc_poll_create(%L, null, %L, %L)', '00000000-0000-4000-8000-0000000e10ff', :'M_ended', 'none')), 'err:42501:%');
select dvt.check('client_history',
  (select string_agg(action || ':' || choice, ',' order by id) from doc_vote_events where user_id = :'u_cli'), 'cast:hold,cast:ng');
select dvt.check('client_signal_meeting',   (select app_can_join_doc_vote_signal('meeting-minutes-view:' || :'M_ended'))::text, 'true');
select dvt.check('client_signal_planned',   (select app_can_join_doc_vote_signal('meeting-minutes-view:' || :'M_planned'))::text, 'false');
select dvt.check('client_signal_wiki',      (select app_can_join_doc_vote_signal('wiki-page-view:' || :'W_pub'))::text, 'true');
select dvt.check('client_signal_wiki_unpub',(select app_can_join_doc_vote_signal('wiki-page-view:' || :'W_unpub'))::text, 'false');

-- ---- vendor も同じ（space に入れる人） ----
select dvt.as_user(:'u_ven');
select dvt.check('vendor_votes', dvt.try(format('select rpc_doc_vote_cast(%L, %L, %L)', :'P_me', 'ok', '')), 'ok');

-- ---- 別の space の相手先は読めない・押せない・入れない ----
select dvt.as_user(:'u_cli2');
select dvt.check('other_client_reads', (select count(*)::text from doc_polls), '0');
select dvt.check('other_client_votes', dvt.try(format('select rpc_doc_vote_cast(%L, %L, %L)', :'P_me', 'ok', '')), 'err:42501:%');
select dvt.check('other_client_signal', (select app_can_join_doc_vote_signal('meeting-minutes-view:' || :'M_ended'))::text, 'false');

-- ---- 二要素認証を登録した相手先は aal2 のときだけ ----
select dvt.as_user(:'u_mfa');
select dvt.check('mfa_client_aal1_vote', dvt.try(format('select rpc_doc_vote_cast(%L, %L, %L)', :'P_me', 'ok', '')), 'err:42501:%');
select dvt.check('mfa_client_aal1_signal', (select app_can_join_doc_vote_signal('meeting-minutes-view:' || :'M_ended'))::text, 'false');
select dvt.as_user(:'u_mfa', 'aal2');
select dvt.check('mfa_client_aal2_vote', dvt.try(format('select rpc_doc_vote_cast(%L, %L, %L)', :'P_me', 'ok', '')), 'ok');

-- ---- 社内は今までどおり（未公開・予定の会議も読める） ----
select dvt.as_user(:'u_ed');
select dvt.check('internal_reads_all', (select count(*)::text from doc_polls), '6');
select dvt.check('internal_signal_planned', (select app_can_join_doc_vote_signal('meeting-minutes-view:' || :'M_planned'))::text, 'true');

-- ---- 別の組織の相手先は読めない・押せない・入れない ----
reset role;
insert into auth.users(id) values (:'u_o2cli');
insert into organizations(id, name) values (:'O2', '別org');
insert into spaces(id, org_id, type, name) values (:'S3', :'O2', 'project', 'S3');
insert into org_memberships(org_id, user_id, role) values (:'O2', :'u_o2cli', 'client');
insert into space_memberships(space_id, user_id, role) values (:'S3', :'u_o2cli', 'client');
set role authenticated;
select dvt.as_user(:'u_o2cli');
select dvt.check('other_org_reads', (select count(*)::text from doc_polls), '0');
select dvt.check('other_org_votes', dvt.try(format('select rpc_doc_vote_cast(%L, %L, %L)', :'P_w', 'ok', '')), 'err:42501:%');
select dvt.check('other_org_signal', (select app_can_join_doc_vote_signal('wiki-page-view:' || :'W_pub'))::text, 'false');

-- ---- 会議を「予定」に戻したら、相手先はもう押せない ----
reset role;
update meetings set status = 'planned' where id = :'M_ended';
set role authenticated;
select dvt.as_user(:'u_cli');
select dvt.check('client_after_replanned', dvt.try(format('select rpc_doc_vote_cast(%L, %L, %L)', :'P_me', 'ok', '')), 'err:42501:%');

-- ---- 公開を取り下げたら、相手先はもう押せない ----
reset role;
update milestone_publications set is_published = false where milestone_id = :'MS1';
set role authenticated;
select dvt.as_user(:'u_cli');
select dvt.check('client_after_unpublish', dvt.try(format('select rpc_doc_vote_cast(%L, %L, %L)', :'P_w', 'ok', '')), 'err:42501:%');

\echo 'DOC POLLS CLIENT 全項目 PASS'
