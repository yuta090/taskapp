-- =============================================================================
-- 相手先の差し込み（doc_insertions・PR5）の検証
-- 前提: run_doc_insertions.sh が空DBに全 migration を適用済み。
-- 仕様: docs/spec/DOC_VOTE_SPEC.md §5・§5.1（Fable 裁定 2026-09-26）
-- =============================================================================
set client_min_messages = notice;

\set O1 '00000000-0000-4000-8000-0000000f0a01'
\set S1 '00000000-0000-4000-8000-0000000f0b01'
\set S2 '00000000-0000-4000-8000-0000000f0b02'
\set u_ed    '00000000-0000-4000-8000-0000000f0c01'
\set u_view  '00000000-0000-4000-8000-0000000f0c02'
\set u_cli   '00000000-0000-4000-8000-0000000f0c03'
\set u_cli2  '00000000-0000-4000-8000-0000000f0c04'
\set u_other '00000000-0000-4000-8000-0000000f0c05'
\set u_mfa   '00000000-0000-4000-8000-0000000f0c06'
\set M_live    '00000000-0000-4000-8000-0000000f0e01'
\set M_planned '00000000-0000-4000-8000-0000000f0e02'
\set W_pub   '00000000-0000-4000-8000-0000000f0d01'
\set W_unpub '00000000-0000-4000-8000-0000000f0d02'
\set MS1 '00000000-0000-4000-8000-0000000f0f01'

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

-- 作った差し込みの番号を覚えておく（呼んだ人の権限で読めなくても、ここに残す）
create table dvt.ids(name text primary key, id uuid);
grant all on dvt.ids to authenticated, anon;
create or replace function dvt.create_as(p_name text, q text) returns text language plpgsql as $$
declare v uuid;
begin
  execute q into v;
  insert into dvt.ids values (p_name, v) on conflict (name) do update set id = excluded.id;
  return 'ok';
exception when others then
  return 'err:' || sqlstate || ':' || sqlerrm;
end $$;
create or replace function dvt.id(p_name text) returns uuid language sql as $$ select id from dvt.ids where name = p_name $$;
grant execute on all functions in schema dvt to authenticated, anon;

-- ---- 下ごしらえ ----
insert into auth.users(id) values (:'u_ed'), (:'u_view'), (:'u_cli'), (:'u_cli2'), (:'u_other'), (:'u_mfa');
insert into profiles(id, display_name) values (:'u_cli', '鈴木 一郎>テスト'), (:'u_cli2', '田中') on conflict (id) do update set display_name = excluded.display_name;
insert into organizations(id, name) values (:'O1', '検証org');
insert into org_memberships(org_id, user_id, role) values
  (:'O1', :'u_ed', 'member'), (:'O1', :'u_view', 'member'), (:'O1', :'u_cli', 'client'),
  (:'O1', :'u_cli2', 'client'), (:'O1', :'u_other', 'client'), (:'O1', :'u_mfa', 'client');
insert into spaces(id, org_id, type, name) values (:'S1', :'O1', 'project', 'S1'), (:'S2', :'O1', 'project', 'S2');
insert into space_memberships(space_id, user_id, role) values
  (:'S1', :'u_ed', 'editor'), (:'S1', :'u_view', 'viewer'), (:'S1', :'u_cli', 'client'),
  (:'S1', :'u_cli2', 'client'), (:'S2', :'u_other', 'client'), (:'S1', :'u_mfa', 'client');
insert into auth.mfa_factors(user_id, status) values (:'u_mfa', 'verified');
insert into meetings(id, org_id, space_id, title, held_at, status, minutes_md, created_by) values
  (:'M_live', :'O1', :'S1', '会議中', now(), 'in_progress', '# 会議中', :'u_ed'),
  (:'M_planned', :'O1', :'S1', '予定', now(), 'planned', '', :'u_ed');
insert into wiki_pages(id, org_id, space_id, title, body, created_by, updated_by) values
  (:'W_pub', :'O1', :'S1', '公開', '[]', :'u_ed', :'u_ed'),
  (:'W_unpub', :'O1', :'S1', '未公開', '[]', :'u_ed', :'u_ed');
insert into milestones(id, org_id, space_id, name) values (:'MS1', :'O1', :'S1', '第1弾');
insert into milestone_publications(org_id, milestone_id, is_published, published_by) values (:'O1', :'MS1', true, :'u_ed');
insert into wiki_page_publications(org_id, milestone_id, source_page_id, published_title, published_body, published_by)
  values (:'O1', :'MS1', :'W_pub', '公開', '[]', :'u_ed');

set role authenticated;

-- ---- 作る ----
select dvt.as_user(:'u_cli');
select dvt.check('create_meeting', dvt.create_as('i1', format(
  'select rpc_doc_insertion_create(null, %L, %L, %L, %L)', :'M_live', 'paragraph', E'会議中に足す行\n2行目', '# 会議中')), 'ok');
select dvt.check('create_note', dvt.create_as('i2', format(
  'select rpc_doc_insertion_create(null, %L, %L, %L, null)', :'M_live', 'meeting_note', 'メモ')), 'ok');
select dvt.check('create_wiki', dvt.create_as('iw', format(
  'select rpc_doc_insertion_create(%L, null, %L, %L, %L)', :'W_pub', 'paragraph', 'Wikiに足す', 'blk-1')), 'ok');
select dvt.check('create_planned', dvt.try(format(
  'select rpc_doc_insertion_create(null, %L, %L, %L, null)', :'M_planned', 'paragraph', 'x')), 'err:42501:%');
select dvt.check('create_unpub', dvt.try(format(
  'select rpc_doc_insertion_create(%L, null, %L, %L, null)', :'W_unpub', 'paragraph', 'x')), 'err:42501:%');
select dvt.check('bad_kind', dvt.try(format(
  'select rpc_doc_insertion_create(null, %L, %L, %L, null)', :'M_live', 'heading', 'x')), 'err:22023:%');
select dvt.check('empty', dvt.try(format(
  'select rpc_doc_insertion_create(null, %L, %L, %L, null)', :'M_live', 'paragraph', E'  \n ')), 'err:22023:%');
select dvt.check('too_long', dvt.try(format(
  'select rpc_doc_insertion_create(null, %L, %L, %L, null)', :'M_live', 'paragraph', repeat('あ', 2001))), 'err:22023:%');
select dvt.check('control_char', dvt.try(format(
  'select rpc_doc_insertion_create(null, %L, %L, %L, null)', :'M_live', 'paragraph', E'a\u0007b')), 'err:22023:%');
-- 本文に目印（<!-- -->）を書かせない。議事録の Markdown で本物の目印（タスク化・投票）として読まれるため
select dvt.check('marker_injection', dvt.try(format(
  'select rpc_doc_insertion_create(null, %L, %L, %L, null)', :'M_live', 'paragraph', '買う<!--task:00000000-0000-0000-0000-000000000000-->')), 'err:22023:%');
select dvt.check('marker_close', dvt.try(format(
  'select rpc_doc_insertion_create(null, %L, %L, %L, null)', :'M_live', 'paragraph', 'a-->b')), 'err:22023:%');
select dvt.check('both_docs', dvt.try(format(
  'select rpc_doc_insertion_create(%L, %L, %L, %L, null)', :'W_pub', :'M_live', 'paragraph', 'x')), 'err:22023:%');

-- 反映待ちは1人×1文書20件まで（i1・i2 で2件。あと18件は通り、21件目で止まる）
do $$ begin
  for i in 1..18 loop
    perform rpc_doc_insertion_create(null, '00000000-0000-4000-8000-0000000f0e01'::uuid, 'paragraph', 'n' || i, null);
  end loop;
end $$;
select dvt.check('limit_21st', dvt.try(format(
  'select rpc_doc_insertion_create(null, %L, %L, %L, null)', :'M_live', 'paragraph', 'over')), 'err:22023:too_many_pending');
-- 別の文書なら数えない
select dvt.check('limit_other_doc', dvt.try(format(
  'select rpc_doc_insertion_create(%L, null, %L, %L, null)', :'W_pub', 'paragraph', 'ok')), 'ok');

-- 名前はプロフィールから取り、目印を壊す > は落とす
reset role;
select dvt.check('author_from_profile',
  (select author_name || '|' || space_id::text || '|' || status from doc_insertions where id = dvt.id('i1')),
  '鈴木 一郎テスト|' || :'S1' || '|pending');
set role authenticated;

-- 社内・別 space の相手先は作れない
select dvt.as_user(:'u_ed');
select dvt.check('internal_cannot_create', dvt.try(format(
  'select rpc_doc_insertion_create(null, %L, %L, %L, null)', :'M_live', 'paragraph', 'x')), 'err:22023:%');
select dvt.as_user(:'u_other');
select dvt.check('other_space_cannot_create', dvt.try(format(
  'select rpc_doc_insertion_create(null, %L, %L, %L, null)', :'M_live', 'paragraph', 'x')), 'err:42501:%');

-- ---- 読める範囲 ----
select dvt.as_user(:'u_cli');
select dvt.check('client_reads_own', (select count(*)::text from doc_insertions), '22');
select dvt.as_user(:'u_cli2');
select dvt.check('client2_reads_none', (select count(*)::text from doc_insertions), '0');
select dvt.as_user(:'u_view');
select dvt.check('internal_reads_all', (select count(*)::text from doc_insertions), '22');

-- ---- 直接は書けない ----
select dvt.as_user(:'u_cli');
select dvt.check('direct_insert', dvt.try(format(
  'insert into doc_insertions(org_id, space_id, meeting_id, kind, content, author_id) values (%L, %L, %L, %L, %L, %L)',
  :'O1', :'S1', :'M_live', 'paragraph', 'x', :'u_cli')), 'err:42501:permission denied%');
select dvt.check('direct_update', dvt.try('update doc_insertions set status = ''applied'''), 'err:42501:permission denied%');
select dvt.check('direct_delete', dvt.try('delete from doc_insertions'), 'err:42501:permission denied%');

-- ---- 反映済みにする（本文に目印が入ってから） ----
select dvt.as_user(:'u_ed');
select dvt.check('apply_before_body', dvt.try(format('select rpc_doc_insertion_mark_applied(%L, false)', dvt.id('i1'))), 'err:22023:not_in_body');
reset role;
update meetings set minutes_md = '# 会議中' || E'\n' || '<!--ins:' || dvt.id('i1') || ' paragraph 2026-09-26T10:00 鈴木-->会議中に足す行' where id = :'M_live';
set role authenticated;
select dvt.as_user(:'u_view');
select dvt.check('viewer_cannot_apply', dvt.try(format('select rpc_doc_insertion_mark_applied(%L, false)', dvt.id('i1'))), 'err:42501:%');
select dvt.as_user(:'u_cli');
select dvt.check('client_cannot_apply', dvt.try(format('select rpc_doc_insertion_mark_applied(%L, false)', dvt.id('i1'))), 'err:42501:%');
select dvt.as_user(:'u_ed');
select dvt.check('apply_ok', dvt.try(format('select rpc_doc_insertion_mark_applied(%L, true)', dvt.id('i1'))), 'ok');
select dvt.check('apply_state', (select status || '|' || anchor_missed::text || '|' || (applied_by = :'u_ed')::text from doc_insertions where id = dvt.id('i1')), 'applied|true|true');
select dvt.check('apply_twice', dvt.try(format('select rpc_doc_insertion_mark_applied(%L, false)', dvt.id('i1'))), 'ok');

-- ---- 取り下げ・削除 ----
select dvt.as_user(:'u_cli2');
select dvt.check('other_cannot_withdraw', dvt.try(format('select rpc_doc_insertion_withdraw(%L)', dvt.id('i2'))), 'err:42501:%');
select dvt.as_user(:'u_cli');
select dvt.check('withdraw_pending', dvt.try(format('select rpc_doc_insertion_withdraw(%L)', dvt.id('i2'))), 'ok');
select dvt.check('withdrawn_state', (select status from doc_insertions where id = dvt.id('i2')), 'withdrawn');
select dvt.check('withdraw_again', dvt.try(format('select rpc_doc_insertion_withdraw(%L)', dvt.id('i2'))), 'err:22023:invalid_state');
select dvt.check('withdraw_applied', dvt.try(format('select rpc_doc_insertion_withdraw(%L)', dvt.id('i1'))), 'ok');
select dvt.check('remove_requested', (select status from doc_insertions where id = dvt.id('i1')), 'remove_requested');
select dvt.as_user(:'u_ed');
select dvt.check('remove_while_in_body', dvt.try(format('select rpc_doc_insertion_mark_removed(%L)', dvt.id('i1'))), 'err:22023:still_in_body');
reset role;
update meetings set minutes_md = '# 会議中' where id = :'M_live';
set role authenticated;
select dvt.check('remove_ok', dvt.try(format('select rpc_doc_insertion_mark_removed(%L)', dvt.id('i1'))), 'ok');
select dvt.check('removed_state', (select status from doc_insertions where id = dvt.id('i1')), 'removed');

-- ---- 二要素認証・未ログイン ----
select dvt.as_user(:'u_mfa');
select dvt.check('mfa_aal1', dvt.try(format(
  'select rpc_doc_insertion_create(null, %L, %L, %L, null)', :'M_live', 'paragraph', 'x')), 'err:42501:%');
select dvt.as_user(:'u_mfa', 'aal2');
select dvt.check('mfa_aal2', dvt.try(format(
  'select rpc_doc_insertion_create(null, %L, %L, %L, null)', :'M_live', 'paragraph', 'x')), 'ok');
reset role;
set role anon;
select dvt.as_user('');
select dvt.check('anon_create', dvt.try(format(
  'select rpc_doc_insertion_create(null, %L, %L, %L, null)', :'M_live', 'paragraph', 'x')), 'err:42501:permission denied%');
reset role;

-- ---- 文書を消すと差し込みも消える ----
delete from meetings where id = :'M_live';
select dvt.check('cascade', (select count(*)::text from doc_insertions where meeting_id = :'M_live'), '0');

\echo 'DOC INSERTIONS 全項目 PASS'
