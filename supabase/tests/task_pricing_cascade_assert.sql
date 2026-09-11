-- =============================================================================
-- task_pricing の space の外部キーを ON DELETE CASCADE にそろえる（*_task_pricing_space_cascade.sql）の挙動検証
-- 前提: run_task_pricing_cascade.sh が _local_bootstrap → Supabase の権限の代役 → migrations を verbatim 適用済み
--   （RED=1 のときは本 migration だけ適用しない）。
--
-- 組織 O1:
--   SP   見積の行がある space（タスク T1・T2 と、その見積の行）   … service_role で消す
--   SD   見積の行が無く、ほかの 11 表に1行ずつある space           … service_role で消す
--   SPB  見積の行がある space（タスク TB と見積の行）             … postgres（SQL エディタと同じ）で消す
--   SN   見積の行が無い space（タスク TN）                         … postgres で消す
-- 人物（request.jwt.claim.sub で名乗る）: ed = 各 space の editor / vw = 各 space の viewer
--
-- label:
--   chg_*    本 migration で変わるもの（適用前は FAIL・適用後は PASS であるべき）
--   same_*   本 migration で変えないもの（両方で PASS）
-- 出力: PASS[label] / FAIL[label]。最後に FAIL が 0 件なら "TASK PRICING CASCADE CHECKS PASSED"。1件でもあれば例外で終了する。
-- 書き込みは test.try / test.flow がサブトランザクションで実行し、必ず巻き戻す（各 assert は独立）。
-- =============================================================================
set client_min_messages = notice;

\set O1  '00000000-0000-0000-0000-00000000a001'
\set SP  '00000000-0000-0000-0000-00000000b001'
\set SD  '00000000-0000-0000-0000-00000000b002'
\set SPB '00000000-0000-0000-0000-00000000b003'
\set SN  '00000000-0000-0000-0000-00000000b004'
\set ed  '00000000-0000-0000-0000-00000000c001'
\set vw  '00000000-0000-0000-0000-00000000c002'
\set T1  '00000000-0000-0000-0000-00000000d001'
\set T2  '00000000-0000-0000-0000-00000000d002'
\set TB  '00000000-0000-0000-0000-00000000d003'
\set TN  '00000000-0000-0000-0000-00000000d004'
\set TD1 '00000000-0000-0000-0000-00000000d101'
\set TD2 '00000000-0000-0000-0000-00000000d102'
\set MD1 '00000000-0000-0000-0000-00000000e101'
\set MTD1 '00000000-0000-0000-0000-000000004201'

-- -----------------------------------------------------------------------------
-- 検証ヘルパ
-- -----------------------------------------------------------------------------
create schema if not exists test;
grant usage on schema test to authenticated, service_role;
create table test.results (seq serial primary key, label text, ok boolean, got text, want text);

-- ほかの 11 表（space を消すと一緒に消える表）
create table test.cascade_tables (tbl text primary key);
grant select on test.cascade_tables to authenticated, service_role;
insert into test.cascade_tables(tbl) values
  ('tasks'), ('milestones'), ('meetings'), ('reviews'), ('task_owners'), ('task_events'), ('task_relations'),
  ('wiki_pages'), ('discussion_items'), ('meeting_participants'), ('task_comments');

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

-- 指定した space の行が、ほかの 11 表のうちいくつの表にあるか
create or replace function test.tables_with_rows(p_space uuid)
returns text language plpgsql security invoker as $$
declare
  r record;
  n bigint;
  v int := 0;
begin
  for r in select tbl from test.cascade_tables loop
    execute format('select count(*) from public.%I where space_id = %L', r.tbl, p_space) into n;
    if n > 0 then v := v + 1; end if;
  end loop;
  return v::text;
end $$;

-- 関数を作る migration が「既定の実行権を付けない」に変わっても使えるよう、補助関数は明示で grant する
grant execute on all functions in schema test to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- データ（行はどれも space と同じ組織）
-- -----------------------------------------------------------------------------
insert into public.organizations(id, name) values (:'O1', 'o1');
insert into auth.users(id) values (:'ed'), (:'vw');
insert into public.org_memberships(org_id, user_id, role) values (:'O1', :'ed', 'owner'), (:'O1', :'vw', 'member');
insert into public.spaces(id, org_id, type, name) values
  (:'SP', :'O1', 'project', 'sp'), (:'SD', :'O1', 'project', 'sd'),
  (:'SPB', :'O1', 'project', 'spb'), (:'SN', :'O1', 'project', 'sn');
insert into public.space_memberships(space_id, user_id, role)
  select s.id, u.user_id, u.role
    from (values (:'SP'::uuid), (:'SD'::uuid), (:'SPB'::uuid), (:'SN'::uuid)) as s(id)
    cross join (values (:'ed'::uuid, 'editor'), (:'vw'::uuid, 'viewer')) as u(user_id, role);

set role service_role;
-- SP・SPB・SN のタスクと、SP・SPB の見積の行（見積の見張りは service_role を通す）
insert into public.tasks(id, org_id, space_id, title, status, created_by) values
  (:'T1', :'O1', :'SP',  't1', 'todo', :'ed'),
  (:'T2', :'O1', :'SP',  't2', 'todo', :'ed'),
  (:'TB', :'O1', :'SPB', 'tb', 'todo', :'ed'),
  (:'TN', :'O1', :'SN',  'tn', 'todo', :'ed');
insert into public.task_pricing(org_id, space_id, task_id) values
  (:'O1', :'SP', :'T1'), (:'O1', :'SP', :'T2'), (:'O1', :'SPB', :'TB');
-- SD（見積の行は無く、ほかの 11 表に1行ずつ）
insert into public.tasks(id, org_id, space_id, title, status, created_by) values
  (:'TD1', :'O1', :'SD', 'td1', 'todo', :'ed'),
  (:'TD2', :'O1', :'SD', 'td2', 'todo', :'ed');
insert into public.milestones(id, org_id, space_id, name) values (:'MD1', :'O1', :'SD', 'md1');
insert into public.meetings(id, org_id, space_id, title, held_at, created_by) values (:'MTD1', :'O1', :'SD', 'mtd1', now(), :'ed');
insert into public.wiki_pages(org_id, space_id, title, created_by, updated_by) values (:'O1', :'SD', 'wd1', :'ed', :'ed');
insert into public.reviews(org_id, space_id, task_id, created_by) values (:'O1', :'SD', :'TD2', :'ed');
insert into public.task_owners(org_id, space_id, task_id, side, user_id) values (:'O1', :'SD', :'TD1', 'internal', :'ed');
insert into public.task_events(org_id, space_id, task_id, actor_id, action) values (:'O1', :'SD', :'TD1', :'ed', 'CREATED');
insert into public.task_relations(org_id, space_id, from_task_id, to_task_id, type) values (:'O1', :'SD', :'TD1', :'TD2', 'related');
insert into public.discussion_items(org_id, space_id, milestone_id, title, status, next_owner, created_by) values
  (:'O1', :'SD', :'MD1', 'di', 'open', 'dev', :'ed');
insert into public.meeting_participants(org_id, space_id, meeting_id, user_id, side) values (:'O1', :'SD', :'MTD1', :'ed', 'internal');
insert into public.task_comments(org_id, space_id, task_id, actor_id, body, visibility) values (:'O1', :'SD', :'TD1', :'ed', 'c', 'internal');
reset role;

-- -----------------------------------------------------------------------------
-- 形: task_pricing の外部キー
-- -----------------------------------------------------------------------------
\echo '== shape =='
select test.check('chg_shape_task_pricing_space_fkeys', (
  select string_agg(c.conname || ':' || c.convalidated::text || ':' || pg_get_constraintdef(c.oid), ',' order by c.conname)
  from pg_constraint c
  where c.conrelid = 'public.task_pricing'::regclass and c.contype = 'f' and c.confrelid = 'public.spaces'::regclass
), 'task_pricing_space_id_fkey:true:FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,'
   'task_pricing_space_org_fkey:true:FOREIGN KEY (space_id, org_id) REFERENCES spaces(id, org_id) ON DELETE CASCADE');

-- task_pricing のほかの外部キーは変えない（task_id は CASCADE・org_id は既定）
select test.check('same_shape_task_pricing_other_fkeys', (
  select string_agg(c.conname || ':' || pg_get_constraintdef(c.oid), ',' order by c.conname)
  from pg_constraint c
  where c.conrelid = 'public.task_pricing'::regclass and c.contype = 'f' and c.confrelid <> 'public.spaces'::regclass
), 'task_pricing_org_id_fkey:FOREIGN KEY (org_id) REFERENCES organizations(id),'
   'task_pricing_task_id_fkey:FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE');

-- ほかの 11 表の space の外部キー（space_id・(space_id, org_id) の 22 本）は、今までどおり CASCADE
select test.check('same_shape_other_11_tables_space_fkeys_cascade', (
  select format('fkeys=%s cascade=%s', count(*), count(*) filter (where c.confdeltype = 'c'))
  from pg_constraint c
  where c.contype = 'f' and c.confrelid = 'public.spaces'::regclass
    and c.conrelid::regclass::text in (select tbl from test.cascade_tables)
), 'fkeys=22 cascade=22');

-- -----------------------------------------------------------------------------
-- space を消す（service_role = サーバー）
-- -----------------------------------------------------------------------------
\echo '== delete as service_role =='
begin;
set local role service_role;
select set_config('request.jwt.claims', '', true);
select set_config('request.jwt.claim.sub', '', true);

-- 見積の行がある space を消すと、タスクも見積の行も一緒に消える
select test.check('chg_delete_space_with_pricing_removes_rows', test.flow(
  array[format('delete from public.spaces where id = %L', :'SP')],
  format('select format(%L, (select count(*) from public.tasks where space_id = %L), (select count(*) from public.task_pricing where space_id = %L))',
         'tasks=%s pricing=%s', :'SP', :'SP')), 'ok:tasks=0 pricing=0');

-- 見積の行が無い space は、今までどおりほかの 11 表の行ごと消える
select test.check('same_sd_rows_in_cascade_tables', test.tables_with_rows(:'SD'), '11');
select test.check('same_delete_space_without_pricing_removes_rows', test.flow(
  array[format('delete from public.spaces where id = %L', :'SD')],
  format('select test.tables_with_rows(%L)', :'SD')), 'ok:0');

-- タスクを消すと、その見積の行も消える（task_id の外部キーは前から CASCADE）
select test.check('same_delete_task_with_pricing_removes_pricing', test.flow(
  array[format('delete from public.tasks where id = %L', :'T1')],
  format('select count(*)::text from public.task_pricing where task_id = %L', :'T1')), 'ok:0');
commit;

-- -----------------------------------------------------------------------------
-- 見積の見張り（guard_task_pricing_delete）は変えない
--   postgres（SQL エディタと同じ）のまま、名乗る人だけを切り替える
--   ※ 本 migration の時点の挙動（見張りの直しの後は run_task_pricing_guard.sh で確かめる）
-- -----------------------------------------------------------------------------
\echo '== pricing guard (unchanged) =='
begin;
select set_config('request.jwt.claims', '', true);

-- ログイン中の人がいないまま、見積の行がある space を消すと止まる（見積の見張りが止める。service_role で消す）
select set_config('request.jwt.claim.sub', '', true);
select test.check('same_delete_space_with_pricing_as_postgres_stopped', test.try(format(
  'delete from public.spaces where id = %L', :'SPB')), 'like:err:%');
-- 止めるのは見積の見張りだけになる（外部キーは CASCADE なので止めない）
select test.check('chg_delete_space_with_pricing_as_postgres_stopped_by_guard', test.try(format(
  'delete from public.spaces where id = %L', :'SPB')),
  'like:err:P0001:permission denied: only admin/editor can delete task pricing%');
-- 見積の行が無い space は、postgres でも消せる
select test.check('same_delete_space_without_pricing_as_postgres', test.try(format(
  'delete from public.spaces where id = %L', :'SN')), 'ok:1');

-- 見積の行だけを直接消す: viewer は止まり、editor は消せる
select set_config('request.jwt.claim.sub', :'vw', true);
select test.check('same_guard_blocks_viewer_pricing_delete', test.try(format(
  'delete from public.task_pricing where task_id = %L', :'T2')),
  'like:err:P0001:permission denied: only admin/editor can delete task pricing%');
select set_config('request.jwt.claim.sub', :'ed', true);
select test.check('same_guard_allows_editor_pricing_delete', test.try(format(
  'delete from public.task_pricing where task_id = %L', :'T2')), 'ok:1');
commit;

-- 巻き戻したので、見積の行は 3 行のまま
select test.check('same_checks_left_no_change', (
  select format('spaces=%s pricing=%s', (select count(*) from public.spaces), (select count(*) from public.task_pricing))
), 'spaces=4 pricing=3');

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
    raise exception 'TASK PRICING CASCADE CHECKS FAILED (% failures)', v_fail;
  end if;
end $$;
select 'TASK PRICING CASCADE CHECKS PASSED' as result;
