-- =============================================================================
-- 相手先の差し込み Wiki（PR6）の検証
-- 前提: run_doc_insertions_wiki.sh が空DBに全 migration を適用済み。
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
\set M2 '00000000-0000-4000-8000-0000000f0e03'

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
insert into auth.users(id) values (:'u_ed'), (:'u_cli'), (:'u_cli2');
insert into organizations(id, name) values (:'O1', '検証org');
insert into org_memberships(org_id, user_id, role) values (:'O1', :'u_ed', 'member'), (:'O1', :'u_cli', 'client'), (:'O1', :'u_cli2', 'client');
insert into spaces(id, org_id, type, name, portal_visible_sections) values (:'S1', :'O1', 'project', 'S1', '{"tasks": true, "requests": true, "all_tasks": true, "files": true, "meetings": true, "wiki": true, "history": true}'::jsonb);
insert into space_memberships(space_id, user_id, role) values (:'S1', :'u_ed', 'editor'), (:'S1', :'u_cli', 'client'), (:'S1', :'u_cli2', 'client');
insert into wiki_pages(id, org_id, space_id, title, body, created_by, updated_by) values
  (:'W_pub', :'O1', :'S1', '公開', '[{"id":"b1","type":"paragraph","props":{},"content":[],"children":[]}]', :'u_ed', :'u_ed'),
  (:'W_unpub', :'O1', :'S1', '未公開', '[]', :'u_ed', :'u_ed');
insert into milestones(id, org_id, space_id, name) values (:'MS1', :'O1', :'S1', '第1弾');
insert into milestone_publications(org_id, milestone_id, is_published, published_by) values (:'O1', :'MS1', true, :'u_ed');
insert into wiki_page_publications(org_id, milestone_id, source_page_id, published_title, published_body, published_by)
  values (:'O1', :'MS1', :'W_pub', '公開', '[]', :'u_ed');

set role authenticated;

-- ---- 作る ----
select dvt.as_user(:'u_cli');
select dvt.check('create_wiki', dvt.create_as('w1', format(
  'select rpc_doc_insertion_create(%L, null, %L, %L, null)', :'W_pub', 'paragraph', 'Wikiに足す')), 'ok');
select dvt.check('create_wiki_note', dvt.create_as('w2', format(
  'select rpc_doc_insertion_create(%L, null, %L, %L, %L)', :'W_pub', 'meeting_note', 'メモ', 'b1')), 'ok');
select dvt.check('create_unpub', dvt.try(format(
  'select rpc_doc_insertion_create(%L, null, %L, %L, null)', :'W_unpub', 'paragraph', 'x')), 'err:42501:%');
-- 本文に自分の差し込みの番号を書き込んでも、目印として数えない（あとで確かめる）
select dvt.check('create_decoy', dvt.create_as('w3', format(
  'select rpc_doc_insertion_create(%L, null, %L, %L, null)', :'W_pub', 'paragraph', 'insertionId ' || dvt.id('w1')::text)), 'ok');

-- ---- 反映済みにする（元のページの本文に、その差し込みのブロックがあるときだけ） ----
reset role;
-- w3 の本文（番号を文字として含む）が本文に入っても、w1 のブロックがあることにはならない
update wiki_pages set body = format(
  '[{"id":"b1","type":"paragraph","props":{},"content":[],"children":[]},'
  '{"id":"%s","type":"docInsertion","props":{"insertionId":"%s","kind":"paragraph"},"content":[{"type":"text","text":"insertionId %s","styles":{}}],"children":[]}]',
  dvt.id('w3'), dvt.id('w3'), dvt.id('w1'))
 where id = :'W_pub';
set role authenticated;
select dvt.as_user(:'u_ed');
select dvt.check('decoy_not_in_body', dvt.try(format('select rpc_doc_insertion_mark_applied(%L, false)', dvt.id('w1'))), 'err:22023:not_in_body');
select dvt.check('w3_in_body', dvt.try(format('select rpc_doc_insertion_mark_applied(%L, false)', dvt.id('w3'))), 'ok');
-- w1 を子つきで入れる（社内がその下に字下げして書き足した）
reset role;
update wiki_pages set body = format(
  '[{"id":"b1","type":"paragraph","props":{},"content":[],"children":[]},'
  '{"id":"%s","type":"docInsertion","props":{"insertionId":"%s","kind":"paragraph"},"content":[],"children":['
  '{"id":"c1","type":"paragraph","props":{},"content":[{"type":"text","text":"社内の補足","styles":{}}],"children":[]}]}]',
  dvt.id('w1'), dvt.id('w1'))
 where id = :'W_pub';
set role authenticated;
select dvt.check('w1_applied', dvt.try(format('select rpc_doc_insertion_mark_applied(%L, false)', dvt.id('w1'))), 'ok');

-- ---- 削除を頼む（下に社内の子の行があれば頼めない） ----
select dvt.as_user(:'u_cli');
select dvt.check('withdraw_has_children', dvt.try(format('select rpc_doc_insertion_withdraw(%L)', dvt.id('w1'))), 'err:22023:has_children');
select dvt.check('withdraw_w3', (select rpc_doc_insertion_withdraw(dvt.id('w3'))), 'remove_requested');
select dvt.check('withdraw_pending_w2', (select rpc_doc_insertion_withdraw(dvt.id('w2'))), 'withdrawn');

-- 本文が JSON として壊れていても、取り下げで落ちない（子の確かめは飛ばす）
reset role;
update wiki_pages set body = 'not json' where id = :'W_pub';
set role authenticated;
select dvt.as_user(:'u_cli');
select dvt.check('create_broken', dvt.create_as('w4', format(
  'select rpc_doc_insertion_create(%L, null, %L, %L, null)', :'W_pub', 'paragraph', 'x')), 'ok');
select dvt.check('withdraw_broken_body', (select rpc_doc_insertion_withdraw(dvt.id('w4'))), 'withdrawn');

-- ---- 本文の書き方に左右されない（jsonb::text の「": "」の形でも見つける） ----
select dvt.as_user(:'u_cli');
select dvt.check('create_w5', dvt.create_as('w5', format(
  'select rpc_doc_insertion_create(%L, null, %L, %L, null)', :'W_pub', 'paragraph', '空白つきの本文')), 'ok');
reset role;
update wiki_pages set body = (format(
  '[{"id":"p1","type":"paragraph","props":{},"content":[],"children":[]},{"id":"%s","type":"docInsertion","props":{"insertionId":"%s","kind":"paragraph"},"content":[],"children":[]}]',
  dvt.id('w5'), dvt.id('w5')))::jsonb::text
 where id = :'W_pub';
set role authenticated;
select dvt.as_user(:'u_ed');
select dvt.check('in_body_jsonb_spacing', dvt.try(format('select rpc_doc_insertion_mark_applied(%L, false)', dvt.id('w5'))), 'ok');

-- ---- 反映待ちで本文に入っていて、下に子の行があれば取り消しを断る ----
select dvt.as_user(:'u_cli');
select dvt.check('create_w6', dvt.create_as('w6', format(
  'select rpc_doc_insertion_create(%L, null, %L, %L, null)', :'W_pub', 'paragraph', '子のつく行')), 'ok');
reset role;
update wiki_pages set body = format(
  '[{"id":"%s","type":"docInsertion","props":{"insertionId":"%s","kind":"paragraph"},"content":[],"children":[{"id":"c9","type":"paragraph","props":{},"content":[],"children":[]}]}]',
  dvt.id('w6'), dvt.id('w6'))
 where id = :'W_pub';
set role authenticated;
select dvt.as_user(:'u_cli');
select dvt.check('withdraw_pending_in_body_children', dvt.try(format('select rpc_doc_insertion_withdraw(%L)', dvt.id('w6'))), 'err:22023:has_children');

-- ---- 子の行があって消せなかった削除依頼は、社内が反映済みに戻せる ----
reset role;
update doc_insertions set status = 'remove_requested' where id = dvt.id('w6');
set role authenticated;
select dvt.as_user(:'u_cli');
select dvt.check('client_cannot_keep', dvt.try(format('select rpc_doc_insertion_keep(%L)', dvt.id('w6'))), 'err:42501:%');
select dvt.as_user(:'u_ed');
select dvt.check('keep_ok', dvt.try(format('select rpc_doc_insertion_keep(%L)', dvt.id('w6'))), 'ok');
select dvt.check('kept_applied', (select status from doc_insertions where id = dvt.id('w6')), 'applied');

-- ---- ポータルで Wiki・会議の欄を切った space では、相手先は書き足せない ----
reset role;
alter table spaces disable trigger user;
update spaces set portal_visible_sections = '{"tasks": true, "requests": true, "all_tasks": true, "files": true, "meetings": false, "wiki": false, "history": true}'::jsonb where id = :'S1';
alter table spaces enable trigger user;
insert into meetings(id, org_id, space_id, title, held_at, status, minutes_md, created_by)
  values ('00000000-0000-4000-8000-0000000f1e01', :'O1', :'S1', '会議', now(), 'ended', '# 会議', :'u_ed');
set role authenticated;
select dvt.as_user(:'u_cli2');
select dvt.check('wiki_section_off', dvt.try(format(
  'select rpc_doc_insertion_create(%L, null, %L, %L, null)', :'W_pub', 'paragraph', 'x')), 'err:42501:%');
select dvt.check('meetings_section_off', dvt.try(format(
  'select rpc_doc_insertion_create(null, %L, %L, %L, null)', '00000000-0000-4000-8000-0000000f1e01', 'paragraph', 'x')), 'err:42501:%');

\echo 'DOC INSERTIONS WIKI 全項目 PASS'
