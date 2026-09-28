-- =============================================================================
-- 投票の「票が変わった」合図のチャネルの検証
-- 前提: run_doc_vote_signal.sh が空DBに全 migration を適用済み。
-- 仕様: docs/spec/DOC_VOTE_SPEC.md §6（合図だけを送る private チャネル）
--
-- チャネル名: meeting-minutes-view:<会議ID> / wiki-page-view:<ページID>
-- 入れる人 = その文書の投票を読める人（app_can_read_doc_poll と同じ: space の社内メンバー。読むだけの人を含む）
--           かつ二要素認証の条件を満たす人。運ぶのは broadcast だけ。
--
-- 視点（org O1 に S1、別 org O2 に S3）:
--   u_ed    社内 member（S1 editor）
--   u_view  社内 member（S1 viewer）… 投票は押せるので合図にも入れる
--   u_cli   相手先（org=client ＋ S1 space=client）… ここの会議は予定のまま・Wiki は未公開なので入れない。
--           読める文書（進行中/終了の会議・公開済みの Wiki）なら入れることは run_doc_polls_client.sh（PR3）で確かめる
--   u_o2    別 org O2 の社内 member … 入れない
--   u_mfa   社内 member（S1 editor）で二要素認証を登録済み。aal1 では入れない
--
-- Realtime はチャネル名を設定 realtime.topic に入れ、その人の役割で realtime.messages を
-- 読み書きしてみて入れるかを決める。ここでも同じことをする。
-- =============================================================================
set client_min_messages = notice;

\set O1 '00000000-0000-4000-8000-0000000e0a01'
\set O2 '00000000-0000-4000-8000-0000000e0a02'
\set S1 '00000000-0000-4000-8000-0000000e0b01'
\set S3 '00000000-0000-4000-8000-0000000e0b03'
\set u_ed   '00000000-0000-4000-8000-0000000e0c01'
\set u_view '00000000-0000-4000-8000-0000000e0c02'
\set u_cli  '00000000-0000-4000-8000-0000000e0c03'
\set u_o2   '00000000-0000-4000-8000-0000000e0c04'
\set u_mfa  '00000000-0000-4000-8000-0000000e0c05'
\set W1 '00000000-0000-4000-8000-0000000e0d01'
\set W3 '00000000-0000-4000-8000-0000000e0d03'
\set M1 '00000000-0000-4000-8000-0000000e0e01'
\set MX '00000000-0000-4000-8000-0000000e0e99'

create schema if not exists dst;
grant usage on schema dst to authenticated, anon;

create or replace function dst.try(q text) returns text language plpgsql as $$
begin
  execute q;
  return 'ok';
exception when others then
  return 'err:' || sqlstate || ':' || sqlerrm;
end $$;

create or replace function dst.check(label text, got text, want text) returns void language plpgsql as $$
begin
  if got is distinct from want and not (want like '%\%%' and got like want) then
    raise exception 'FAIL[%] got=% want=%', label, got, want;
  end if;
  raise notice 'PASS[%]', label;
end $$;

create or replace function dst.as_user(p_uid text, p_aal text default '') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_uid, false);
  perform set_config('request.jwt.claims',
    case when p_aal = '' then '' else json_build_object('sub', p_uid, 'aal', p_aal)::text end, false);
end $$;

-- そのチャネルで送れるか（Realtime が送信の可否を見るのと同じく、realtime.messages へ insert してみる）
create or replace function dst.send(p_topic text, p_ext text default 'broadcast') returns text language plpgsql as $$
begin
  perform set_config('realtime.topic', p_topic, false);
  return dst.try(format(
    'insert into realtime.messages(topic, extension, event, private) values (%L, %L, %L, true)',
    p_topic, p_ext, 'vote-changed'));
end $$;

-- そのチャネルを受け取れるか（読める行があるか）。下ごしらえで各チャネルに1行ずつ入れてある
create or replace function dst.recv(p_topic text, p_ext text default 'broadcast') returns text language plpgsql as $$
declare n int;
begin
  perform set_config('realtime.topic', p_topic, false);
  select count(*) into n from realtime.messages where topic = p_topic and extension = p_ext;
  return case when n > 0 then 'ok' else 'none' end;
end $$;

grant execute on all functions in schema dst to authenticated, anon;

-- ---- 下ごしらえ（superuser で入れる） ----
insert into auth.users(id) values (:'u_ed'), (:'u_view'), (:'u_cli'), (:'u_o2'), (:'u_mfa');
insert into organizations(id, name) values (:'O1', '検証org1'), (:'O2', '検証org2');
insert into org_memberships(org_id, user_id, role) values
  (:'O1', :'u_ed', 'member'), (:'O1', :'u_view', 'member'), (:'O1', :'u_cli', 'client'),
  (:'O2', :'u_o2', 'member'), (:'O1', :'u_mfa', 'member');
insert into spaces(id, org_id, type, name) values
  (:'S1', :'O1', 'project', 'S1'), (:'S3', :'O2', 'project', 'S3');
insert into space_memberships(space_id, user_id, role) values
  (:'S1', :'u_ed', 'editor'), (:'S1', :'u_view', 'viewer'), (:'S1', :'u_cli', 'client'),
  (:'S3', :'u_o2', 'editor'), (:'S1', :'u_mfa', 'editor');
insert into auth.mfa_factors(user_id, status) values (:'u_mfa', 'verified');
insert into wiki_pages(id, org_id, space_id, title, body, created_by, updated_by) values
  (:'W1', :'O1', :'S1', 'W1', '[]', :'u_ed', :'u_ed'),
  (:'W3', :'O2', :'S3', 'W3', '[]', :'u_o2', :'u_o2');
insert into meetings(id, org_id, space_id, title, held_at, created_by) values
  (:'M1', :'O1', :'S1', 'M1', now(), :'u_ed');
insert into realtime.messages(topic, extension, event, private) values
  ('meeting-minutes-view:' || :'M1', 'broadcast', 'vote-changed', true),
  ('meeting-minutes-view:' || :'M1', 'presence', 'x', true),
  ('wiki-page-view:' || :'W1', 'broadcast', 'vote-changed', true),
  ('wiki-page-view:' || :'W3', 'broadcast', 'vote-changed', true),
  ('meeting-minutes:' || :'M1', 'broadcast', 'x', true);

set role authenticated;

-- ---- 社内の編集者: 議事録・Wiki とも送れて受け取れる ----
select dst.as_user(:'u_ed');
select dst.check('ed_meeting_send', dst.send('meeting-minutes-view:' || :'M1'), 'ok');
select dst.check('ed_meeting_recv', dst.recv('meeting-minutes-view:' || :'M1'), 'ok');
select dst.check('ed_wiki_send', dst.send('wiki-page-view:' || :'W1'), 'ok');
select dst.check('ed_wiki_recv', dst.recv('wiki-page-view:' || :'W1'), 'ok');
-- 合図のチャネルでは presence（在席）は使わない
select dst.check('ed_presence_send', dst.send('meeting-minutes-view:' || :'M1', 'presence'), 'err:42501:%');
select dst.check('ed_presence_recv', dst.recv('meeting-minutes-view:' || :'M1', 'presence'), 'none');
-- 別の組織のページ・存在しない会議・形の合わない名前・種類の取り違え
select dst.check('ed_other_org_wiki', dst.send('wiki-page-view:' || :'W3'), 'err:42501:%');
select dst.check('ed_other_org_wiki_recv', dst.recv('wiki-page-view:' || :'W3'), 'none');
select dst.check('ed_missing_meeting', dst.send('meeting-minutes-view:' || :'MX'), 'err:42501:%');
select dst.check('ed_bad_topic', dst.send('meeting-minutes-view:not-a-uuid'), 'err:42501:%');
select dst.check('ed_suffix_topic', dst.send('meeting-minutes-view:' || :'M1' || 'x'), 'err:42501:%');
select dst.check('ed_kind_swapped', dst.send('wiki-page-view:' || :'M1'), 'err:42501:%');
-- 既存の同時編集のチャネルには、編集者は今までどおり入れる（この migration で壊れていない）
select dst.check('ed_collab_still_ok', dst.send('meeting-minutes:' || :'M1'), 'ok');

-- ---- 読むだけの社内メンバー: 投票は押せるので合図にも入れる ----
select dst.as_user(:'u_view');
select dst.check('view_meeting_send', dst.send('meeting-minutes-view:' || :'M1'), 'ok');
select dst.check('view_wiki_recv', dst.recv('wiki-page-view:' || :'W1'), 'ok');
-- 同時編集のチャネル（meeting-minutes:）は今までどおり書ける人だけ（この migration で広がらない）
select dst.check('view_collab_unchanged', dst.send('meeting-minutes:' || :'M1'), 'err:42501:%');

-- ---- 相手先・別組織: 入れない ----
select dst.as_user(:'u_cli');
select dst.check('cli_meeting_send', dst.send('meeting-minutes-view:' || :'M1'), 'err:42501:%');
select dst.check('cli_meeting_recv', dst.recv('meeting-minutes-view:' || :'M1'), 'none');
select dst.check('cli_wiki_recv', dst.recv('wiki-page-view:' || :'W1'), 'none');
select dst.as_user(:'u_o2');
select dst.check('o2_meeting_send', dst.send('meeting-minutes-view:' || :'M1'), 'err:42501:%');
select dst.check('o2_wiki_recv', dst.recv('wiki-page-view:' || :'W1'), 'none');

-- ---- 二要素認証を登録した人: aal1 では入れず、aal2 なら入れる ----
select dst.as_user(:'u_mfa', 'aal1');
select dst.check('mfa_aal1_send', dst.send('meeting-minutes-view:' || :'M1'), 'err:42501:%');
select dst.check('mfa_aal1_recv', dst.recv('wiki-page-view:' || :'W1'), 'none');
select dst.as_user(:'u_mfa', 'aal2');
select dst.check('mfa_aal2_send', dst.send('meeting-minutes-view:' || :'M1'), 'ok');

-- ---- 未ログイン: 入れない ----
reset role;
set role anon;
select dst.as_user('');
select dst.check('anon_send', dst.send('meeting-minutes-view:' || :'M1'), 'err:42501:%');
select dst.check('anon_recv', dst.recv('wiki-page-view:' || :'W1'), 'none');
reset role;

-- ---- 判定関数の実行権: authenticated だけ ----
select dst.check('fn_grant_authenticated',
  has_function_privilege('authenticated', 'public.app_can_join_doc_vote_signal(text)', 'execute')::text, 'true');
select dst.check('fn_no_service_role',
  has_function_privilege('service_role', 'public.app_can_join_doc_vote_signal(text)', 'execute')::text, 'false');
select dst.check('fn_no_anon',
  has_function_privilege('anon', 'public.app_can_join_doc_vote_signal(text)', 'execute')::text, 'false');

\echo 'DOC VOTE SIGNAL 全項目 PASS'
