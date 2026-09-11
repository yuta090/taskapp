-- =============================================================================
-- space 単位の表の行は、同じ組織の space だけを指す（*_space_org_fk.sql）の挙動検証
-- 前提: run_space_org_fk.sh が _local_bootstrap → Supabase の権限の代役 → migrations を verbatim 適用済み。
--
-- 組織 O1: S1・SD と SPR（消す試験用）。組織 O2: S2。
-- 12 表（tasks / milestones / meetings / reviews / task_owners / task_pricing / task_events / task_relations /
--   wiki_pages / discussion_items / meeting_participants / task_comments）に S1 の行を1つずつ入れておく。
--   SD には task_pricing 以外の 11 表の行を1つずつ、SPR にはタスクと task_pricing の行を入れておく。
-- service_role（RLS を通らない）で書き込む:
--   same_<表>_insert_same_org      … space と同じ組織の org_id の行は入る
--   chg_<表>_insert_other_org      … space は O1・org_id は O2 の行は入らない（23503）
--   chg_<表>_update_org_to_other   … 行の org_id を、space の組織と違う組織に変えられない（23503）
--   same_delete_space_removes_rows … space を消すと、その space の行が消える（CASCADE の 11 表）
--   same_delete_space_with_task_pricing_blocked … task_pricing の行がある space は消せない（space の外部キーが NO ACTION）
--
-- label:
--   chg_*    本 migration で定める規則
--   same_*   本 migration で変えない規則
-- 出力: PASS[label] / FAIL[label]。最後に FAIL が 0 件なら "SPACE ORG FK CHECKS PASSED"。1件でもあれば例外で終了する。
-- 書き込みは test.try / test.flow がサブトランザクションで実行し、必ず巻き戻す（各 assert は独立）。
-- =============================================================================
set client_min_messages = notice;

\set O1 '00000000-0000-0000-0000-00000000a001'
\set O2 '00000000-0000-0000-0000-00000000a002'
\set S1 '00000000-0000-0000-0000-00000000b001'
\set S2 '00000000-0000-0000-0000-00000000b002'
\set SD '00000000-0000-0000-0000-00000000b003'
\set u  '00000000-0000-0000-0000-00000000c001'
\set u2 '00000000-0000-0000-0000-00000000c002'
-- S1 の行
\set T1   '00000000-0000-0000-0000-00000000d001'
\set T2   '00000000-0000-0000-0000-00000000d002'
\set M1   '00000000-0000-0000-0000-00000000e001'
\set MT1  '00000000-0000-0000-0000-000000004001'
\set W1   '00000000-0000-0000-0000-000000001001'
\set R1   '00000000-0000-0000-0000-000000005001'
\set TO1  '00000000-0000-0000-0000-000000006001'
\set TPR1 '00000000-0000-0000-0000-000000007001'
\set TE1  '00000000-0000-0000-0000-000000006002'
\set TR1  '00000000-0000-0000-0000-000000006003'
\set DI1  '00000000-0000-0000-0000-000000006004'
\set MTP1 '00000000-0000-0000-0000-000000004101'
\set C1   '00000000-0000-0000-0000-000000007101'
-- SD の行（space を消す試験用）
\set TD1   '00000000-0000-0000-0000-00000000d101'
\set TD2   '00000000-0000-0000-0000-00000000d102'
\set MD1   '00000000-0000-0000-0000-00000000e101'
\set MTD1  '00000000-0000-0000-0000-000000004201'
\set WD1   '00000000-0000-0000-0000-000000001101'
-- SPR の行（task_pricing の行がある space）
\set SPR   '00000000-0000-0000-0000-00000000b004'
\set TPRT  '00000000-0000-0000-0000-00000000d201'

-- -----------------------------------------------------------------------------
-- 検証ヘルパ
-- -----------------------------------------------------------------------------
create schema if not exists test;
grant usage on schema test to authenticated, service_role;
create table test.results (seq serial primary key, label text, ok boolean, got text, want text);

create table test.ids (k text primary key, v uuid not null);
grant select on test.ids to authenticated, service_role;
insert into test.ids(k, v) values
  ('O1', :'O1'), ('O2', :'O2'), ('S1', :'S1'), ('SD', :'SD'), ('u', :'u'), ('u2', :'u2'),
  ('T1', :'T1'), ('T2', :'T2'), ('M1', :'M1'), ('MT1', :'MT1');

create or replace function test.id(p_k text) returns uuid language sql stable as $$
  select v from test.ids where k = p_k;
$$;

-- 対象の 12 表と、S1 にある各表の行（update の試験で使う）
create table test.targets (tbl text primary key, row_id uuid not null);
grant select on test.targets to authenticated, service_role;
insert into test.targets(tbl, row_id) values
  ('tasks', :'T1'), ('milestones', :'M1'), ('meetings', :'MT1'), ('reviews', :'R1'),
  ('task_owners', :'TO1'), ('task_pricing', :'TPR1'), ('task_events', :'TE1'), ('task_relations', :'TR1'),
  ('wiki_pages', :'W1'), ('discussion_items', :'DI1'), ('meeting_participants', :'MTP1'), ('task_comments', :'C1');

-- 結果の記録（definer: service_role の視点のままでも記録できる）
--   want が 'like:' で始まるときは LIKE で、それ以外は完全一致で比べる。
create or replace function test.check(p_label text, p_got text, p_want text)
returns void language plpgsql security definer set search_path = test, public as $$
declare
  v_ok boolean := coalesce(
    case when p_want like 'like:%' then p_got like substr(p_want, 6) else p_got = p_want end, false);
begin
  insert into test.results(label, ok, got, want) values (p_label, v_ok, p_got, p_want);
  if v_ok then
    raise notice 'PASS[%]: %', p_label, p_got;
  else
    raise notice 'FAIL[%]: got %, want %', p_label, coalesce(p_got, 'NULL'), p_want;
  end if;
end $$;

-- 呼んだ人の権限で SQL を1つ流し、影響した行数を返して必ず巻き戻す
--   ok:<行数> / err:<SQLSTATE>:<メッセージ>
create or replace function test.try(p_sql text)
returns text language plpgsql security invoker as $$
declare
  v_n bigint;
  v_state text;
  v_detail text;
  v_msg text;
begin
  begin
    execute p_sql;
    get diagnostics v_n = row_count;
    raise exception 'test_rollback' using errcode = 'TR001', detail = v_n::text;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail, v_msg = message_text;
    if v_state = 'TR001' then return 'ok:' || v_detail; end if;
    return 'err:' || v_state || ':' || v_msg;
  end;
end $$;

-- 呼んだ人の権限で SQL を順に流し、最後に p_probe の値を返して必ず巻き戻す
create or replace function test.flow(p_sqls text[], p_probe text)
returns text language plpgsql security invoker as $$
declare
  s text;
  v text;
  v_state text;
  v_detail text;
  v_msg text;
begin
  begin
    foreach s in array p_sqls loop
      execute s;
    end loop;
    execute p_probe into v;
    raise exception 'test_rollback' using errcode = 'TR001', detail = coalesce(v, 'NULL');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail, v_msg = message_text;
    if v_state = 'TR001' then return 'ok:' || v_detail; end if;
    return 'err:' || v_state || ':' || v_msg;
  end;
end $$;

-- 表ごとの insert（親の行は S1 のもの。space と org_id だけを引数で変える）
create or replace function test.ins_sql(p_tbl text, p_space uuid, p_org uuid)
returns text language plpgsql stable as $$
declare
  u uuid := test.id('u');
  u2 uuid := test.id('u2');
  t1 uuid := test.id('T1');
  t2 uuid := test.id('T2');
  m1 uuid := test.id('M1');
  mt1 uuid := test.id('MT1');
begin
  return case p_tbl
    when 'tasks' then format(
      'insert into public.tasks(org_id, space_id, title, status, created_by) values (%L, %L, %L, %L, %L)',
      p_org, p_space, 'x', 'todo', u)
    when 'milestones' then format(
      'insert into public.milestones(org_id, space_id, name) values (%L, %L, %L)', p_org, p_space, 'x')
    when 'meetings' then format(
      'insert into public.meetings(org_id, space_id, title, held_at, created_by) values (%L, %L, %L, now(), %L)',
      p_org, p_space, 'x', u)
    when 'reviews' then format(
      'insert into public.reviews(org_id, space_id, task_id, created_by) values (%L, %L, %L, %L)', p_org, p_space, t1, u)
    when 'task_owners' then format(
      'insert into public.task_owners(org_id, space_id, task_id, side, user_id) values (%L, %L, %L, %L, %L)',
      p_org, p_space, t1, 'client', u)
    when 'task_pricing' then format(
      'insert into public.task_pricing(org_id, space_id, task_id) values (%L, %L, %L)', p_org, p_space, t2)
    when 'task_events' then format(
      'insert into public.task_events(org_id, space_id, task_id, actor_id, action) values (%L, %L, %L, %L, %L)',
      p_org, p_space, t1, u, 'X')
    when 'task_relations' then format(
      'insert into public.task_relations(org_id, space_id, from_task_id, to_task_id, type) values (%L, %L, %L, %L, %L)',
      p_org, p_space, t2, t1, 'related')
    when 'wiki_pages' then format(
      'insert into public.wiki_pages(org_id, space_id, title, created_by, updated_by) values (%L, %L, %L, %L, %L)',
      p_org, p_space, 'x', u, u)
    when 'discussion_items' then format(
      'insert into public.discussion_items(org_id, space_id, milestone_id, title, status, next_owner, created_by) values (%L, %L, %L, %L, %L, %L, %L)',
      p_org, p_space, m1, 'x', 'open', 'dev', u)
    when 'meeting_participants' then format(
      'insert into public.meeting_participants(org_id, space_id, meeting_id, user_id, side) values (%L, %L, %L, %L, %L)',
      p_org, p_space, mt1, u2, 'internal')
    when 'task_comments' then format(
      'insert into public.task_comments(org_id, space_id, task_id, actor_id, body, visibility) values (%L, %L, %L, %L, %L, %L)',
      p_org, p_space, t1, u, 'c', 'internal')
  end;
end $$;

-- 12 表それぞれで、同じ組織なら入る・違う組織の行は入らない・org_id を違う組織に変えられない
create or replace function test.fk_checks()
returns void language plpgsql security invoker as $$
declare
  r record;
  o1 uuid := test.id('O1');
  o2 uuid := test.id('O2');
  s1 uuid := test.id('S1');
begin
  for r in select tbl, row_id from test.targets order by tbl collate "C" loop
    perform test.check('same_' || r.tbl || '_insert_same_org', test.try(test.ins_sql(r.tbl, s1, o1)), 'ok:1');
    perform test.check('chg_' || r.tbl || '_insert_other_org', test.try(test.ins_sql(r.tbl, s1, o2)),
                       'like:err:23503:%"' || r.tbl || '_space_org_fkey"%');
    perform test.check('chg_' || r.tbl || '_update_org_to_other',
                       test.try(format('update public.%I set org_id = %L where id = %L', r.tbl, o2, r.row_id)),
                       'like:err:23503:%"' || r.tbl || '_space_org_fkey"%');
  end loop;
end $$;

-- 指定した space の行が、12 表のうちいくつの表にあるか
create or replace function test.tables_with_rows(p_space uuid)
returns text language plpgsql security invoker as $$
declare
  r record;
  n bigint;
  v int := 0;
begin
  for r in select tbl from test.targets loop
    execute format('select count(*) from public.%I where space_id = %L', r.tbl, p_space) into n;
    if n > 0 then v := v + 1; end if;
  end loop;
  return v::text;
end $$;

-- -----------------------------------------------------------------------------
-- データ（postgres で投入。行はどれも space と同じ組織）
-- -----------------------------------------------------------------------------
insert into public.organizations(id, name) values (:'O1', 'o1'), (:'O2', 'o2');
insert into auth.users(id) values (:'u'), (:'u2');
insert into public.spaces(id, org_id, type, name) values
  (:'S1', :'O1', 'project', 's1'),
  (:'S2', :'O2', 'project', 's2'),
  (:'SD', :'O1', 'project', 'sd'),
  (:'SPR', :'O1', 'project', 'spr');

set role service_role;
-- S1
insert into public.tasks(id, org_id, space_id, title, status, created_by) values
  (:'T1', :'O1', :'S1', 't1', 'todo', :'u'),
  (:'T2', :'O1', :'S1', 't2', 'todo', :'u');
insert into public.milestones(id, org_id, space_id, name) values (:'M1', :'O1', :'S1', 'm1');
insert into public.meetings(id, org_id, space_id, title, held_at, created_by) values (:'MT1', :'O1', :'S1', 'mt1', now(), :'u');
insert into public.wiki_pages(id, org_id, space_id, title, created_by, updated_by) values (:'W1', :'O1', :'S1', 'w1', :'u', :'u');
insert into public.reviews(id, org_id, space_id, task_id, created_by) values (:'R1', :'O1', :'S1', :'T2', :'u');
insert into public.task_owners(id, org_id, space_id, task_id, side, user_id) values (:'TO1', :'O1', :'S1', :'T1', 'internal', :'u');
insert into public.task_pricing(id, org_id, space_id, task_id) values (:'TPR1', :'O1', :'S1', :'T1');
insert into public.task_events(id, org_id, space_id, task_id, actor_id, action) values (:'TE1', :'O1', :'S1', :'T1', :'u', 'CREATED');
insert into public.task_relations(id, org_id, space_id, from_task_id, to_task_id, type) values (:'TR1', :'O1', :'S1', :'T1', :'T2', 'related');
insert into public.discussion_items(id, org_id, space_id, milestone_id, title, status, next_owner, created_by) values
  (:'DI1', :'O1', :'S1', :'M1', 'di', 'open', 'dev', :'u');
insert into public.meeting_participants(id, org_id, space_id, meeting_id, user_id, side) values (:'MTP1', :'O1', :'S1', :'MT1', :'u', 'internal');
insert into public.task_comments(id, org_id, space_id, task_id, actor_id, body, visibility) values (:'C1', :'O1', :'S1', :'T1', :'u', 'c', 'internal');
-- SD（task_pricing 以外の 11 表に1行ずつ）
insert into public.tasks(id, org_id, space_id, title, status, created_by) values
  (:'TD1', :'O1', :'SD', 'td1', 'todo', :'u'),
  (:'TD2', :'O1', :'SD', 'td2', 'todo', :'u');
insert into public.milestones(id, org_id, space_id, name) values (:'MD1', :'O1', :'SD', 'md1');
insert into public.meetings(id, org_id, space_id, title, held_at, created_by) values (:'MTD1', :'O1', :'SD', 'mtd1', now(), :'u');
insert into public.wiki_pages(id, org_id, space_id, title, created_by, updated_by) values (:'WD1', :'O1', :'SD', 'wd1', :'u', :'u');
insert into public.reviews(org_id, space_id, task_id, created_by) values (:'O1', :'SD', :'TD2', :'u');
insert into public.task_owners(org_id, space_id, task_id, side, user_id) values (:'O1', :'SD', :'TD1', 'internal', :'u');
insert into public.task_events(org_id, space_id, task_id, actor_id, action) values (:'O1', :'SD', :'TD1', :'u', 'CREATED');
insert into public.task_relations(org_id, space_id, from_task_id, to_task_id, type) values (:'O1', :'SD', :'TD1', :'TD2', 'related');
insert into public.discussion_items(org_id, space_id, milestone_id, title, status, next_owner, created_by) values
  (:'O1', :'SD', :'MD1', 'di', 'open', 'dev', :'u');
insert into public.meeting_participants(org_id, space_id, meeting_id, user_id, side) values (:'O1', :'SD', :'MTD1', :'u', 'internal');
insert into public.task_comments(org_id, space_id, task_id, actor_id, body, visibility) values (:'O1', :'SD', :'TD1', :'u', 'c', 'internal');
-- SPR（タスクと task_pricing の行）
insert into public.tasks(id, org_id, space_id, title, status, created_by) values (:'TPRT', :'O1', :'SPR', 'tprt', 'todo', :'u');
insert into public.task_pricing(org_id, space_id, task_id) values (:'O1', :'SPR', :'TPRT');
reset role;

-- -----------------------------------------------------------------------------
-- 書き込み（service_role）
-- -----------------------------------------------------------------------------
\echo '== writes as service_role =='
begin;
set local role service_role;
select set_config('request.jwt.claims', '', true);

select test.fk_checks();

-- space を消すと、その space の行が消える（CASCADE の 11 表）
select test.check('same_sd_rows_in_cascade_tables', test.tables_with_rows(:'SD'), '11');
select test.check('same_delete_space_removes_rows', test.flow(
  array[format('delete from public.spaces where id = %L', :'SD')],
  format('select test.tables_with_rows(%L)', :'SD')), 'ok:0');
-- task_pricing の行がある space は消せない（task_pricing の space の外部キーは NO ACTION）
select test.check('same_delete_space_with_task_pricing_blocked', test.try(format(
  'delete from public.spaces where id = %L', :'SPR')), 'like:err:23503:%"task_pricing_space_%fkey"%');
commit;

-- -----------------------------------------------------------------------------
-- 形: 外部キー・索引
-- -----------------------------------------------------------------------------
\echo '== shape =='
-- 12 表に (space_id, org_id) → spaces (id, org_id) の外部キー（確かめ済み）。ON DELETE は space_id の外部キーと同じ
select test.check('chg_shape_space_org_fkeys', (
  select coalesce(string_agg(c.conrelid::regclass::text || ':' || c.conname || ':' || c.convalidated::text || ':'
                             || pg_get_constraintdef(c.oid), ',' order by c.conrelid::regclass::text collate "C"), '(none)')
  from pg_constraint c
  where c.contype = 'f'
    and c.confrelid = 'public.spaces'::regclass
    and c.conrelid::regclass::text in (select tbl from test.targets)
    and array_length(c.conkey, 1) = 2
), 'discussion_items:discussion_items_space_org_fkey:true:FOREIGN KEY (space_id, org_id) REFERENCES spaces(id, org_id) ON DELETE CASCADE,'
   'meeting_participants:meeting_participants_space_org_fkey:true:FOREIGN KEY (space_id, org_id) REFERENCES spaces(id, org_id) ON DELETE CASCADE,'
   'meetings:meetings_space_org_fkey:true:FOREIGN KEY (space_id, org_id) REFERENCES spaces(id, org_id) ON DELETE CASCADE,'
   'milestones:milestones_space_org_fkey:true:FOREIGN KEY (space_id, org_id) REFERENCES spaces(id, org_id) ON DELETE CASCADE,'
   'reviews:reviews_space_org_fkey:true:FOREIGN KEY (space_id, org_id) REFERENCES spaces(id, org_id) ON DELETE CASCADE,'
   'task_comments:task_comments_space_org_fkey:true:FOREIGN KEY (space_id, org_id) REFERENCES spaces(id, org_id) ON DELETE CASCADE,'
   'task_events:task_events_space_org_fkey:true:FOREIGN KEY (space_id, org_id) REFERENCES spaces(id, org_id) ON DELETE CASCADE,'
   'task_owners:task_owners_space_org_fkey:true:FOREIGN KEY (space_id, org_id) REFERENCES spaces(id, org_id) ON DELETE CASCADE,'
   'task_pricing:task_pricing_space_org_fkey:true:FOREIGN KEY (space_id, org_id) REFERENCES spaces(id, org_id),'
   'task_relations:task_relations_space_org_fkey:true:FOREIGN KEY (space_id, org_id) REFERENCES spaces(id, org_id) ON DELETE CASCADE,'
   'tasks:tasks_space_org_fkey:true:FOREIGN KEY (space_id, org_id) REFERENCES spaces(id, org_id) ON DELETE CASCADE,'
   'wiki_pages:wiki_pages_space_org_fkey:true:FOREIGN KEY (space_id, org_id) REFERENCES spaces(id, org_id) ON DELETE CASCADE');

-- space_id だけの外部キーは残す（名前と ON DELETE は変えない）
select test.check('same_shape_space_id_fkeys_kept', (
  select string_agg(c.conrelid::regclass::text || ':' || c.conname || ':' || pg_get_constraintdef(c.oid), ','
                    order by c.conrelid::regclass::text collate "C")
  from pg_constraint c
  where c.contype = 'f'
    and c.confrelid = 'public.spaces'::regclass
    and c.conrelid::regclass::text in (select tbl from test.targets)
    and array_length(c.conkey, 1) = 1
), 'discussion_items:discussion_items_space_id_fkey:FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,'
   'meeting_participants:meeting_participants_space_id_fkey:FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,'
   'meetings:meetings_space_id_fkey:FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,'
   'milestones:milestones_space_id_fkey:FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,'
   'reviews:reviews_space_id_fkey:FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,'
   'task_comments:task_comments_space_id_fkey:FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,'
   'task_events:task_events_space_id_fkey:FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,'
   'task_owners:task_owners_space_id_fkey:FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,'
   'task_pricing:task_pricing_space_id_fkey:FOREIGN KEY (space_id) REFERENCES spaces(id),'
   'task_relations:task_relations_space_id_fkey:FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,'
   'tasks:tasks_space_id_fkey:FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,'
   'wiki_pages:wiki_pages_space_id_fkey:FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE');

-- channel_* の6表の外部キー（同じ形・変えない）
select test.check('same_shape_channel_space_org_fkeys', (
  select count(*)::text from pg_constraint c
  where c.contype = 'f' and c.confrelid = 'public.spaces'::regclass and array_length(c.conkey, 1) = 2
    and c.conrelid::regclass::text like 'channel\_%'
), '6');

-- spaces (id, org_id) の一意の索引（20260710204722_channel_plumbing.sql で作ったもの）
select test.check('same_shape_spaces_id_org_unique', (
  select pg_get_indexdef(i.indexrelid) from pg_index i
  where i.indrelid = 'public.spaces'::regclass and i.indexrelid::regclass::text = 'spaces_id_org_unique'
), 'CREATE UNIQUE INDEX spaces_id_org_unique ON public.spaces USING btree (id, org_id)');

-- 二要素認証の RESTRICTIVE: RLS が有効な public の全表にある
select test.check('same_shape_mfa_on_all_rls_tables', (
  select count(*)::text from pg_tables t
  where t.schemaname = 'public' and t.rowsecurity
    and not exists (select 1 from pg_policies p
                    where p.schemaname = 'public' and p.tablename = t.tablename
                      and p.policyname = 'mfa_required_when_enrolled')
), '0');

-- -----------------------------------------------------------------------------
-- 集計
-- -----------------------------------------------------------------------------
do $$
declare
  v_pass int;
  v_fail int;
begin
  select count(*) filter (where ok), count(*) filter (where not ok) into v_pass, v_fail from test.results;
  raise notice 'SUMMARY: PASS=% FAIL=%', v_pass, v_fail;
  if v_fail > 0 then
    raise exception 'SPACE ORG FK CHECKS FAILED (% failures)', v_fail;
  end if;
end $$;
select 'SPACE ORG FK CHECKS PASSED' as result;
