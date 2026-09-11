-- =============================================================================
-- 見積の行を消すときの見張りが、タスク・space を消したときの連鎖削除を通す（*_task_pricing_guard_cascade.sql）の挙動検証
-- 前提: run_task_pricing_guard.sh が _local_bootstrap → Supabase の権限の代役 → migrations を verbatim 適用済み
--   （RED=1 のときは本 migration だけ適用しない）。space の外部キーは CASCADE（*_task_pricing_space_cascade.sql）。
--   本文の変わり方（土台に確認を足しただけ）は、ハーネスが適用前後のスキーマの指紋とロールバックで確かめる。
--
-- 組織 O1。どの space にも同じ人が同じ役割でいる:
--   adm = admin（組織の owner）/ ed = editor / vw = viewer / cl = 相手先（client）/ vnd = 協力会社（vendor）
--   mb  = 組織の社内メンバー（member）だが、どの space にも役割が無い
--   S1  タスク T1〜T4 と、その見積の行（タスクを消す・見積の行だけを消す）
--   S2  タスク T5 と見積の行（admin が space を消す）
--   S3  タスク T6 と見積の行（SQL エディタ = postgres が space を消す）
-- 画面と同じ書き込みは set role authenticated ＋ request.jwt.claims（RLS を通る）。
-- 見張りだけを見る書き込みは postgres のまま request.jwt.claim.sub で名乗る（RLS を通らない）。
--
-- label:
--   chg_*    本 migration で変わるもの（適用前は FAIL・適用後は PASS であるべき）
--   same_*   本 migration で変えないもの（両方で PASS）
-- 出力: PASS[label] / FAIL[label]。最後に FAIL が 0 件なら "TASK PRICING GUARD CHECKS PASSED"。1件でもあれば例外で終了する。
-- 書き込みは test.try / test.flow がサブトランザクションで実行し、必ず巻き戻す（各 assert は独立）。
-- =============================================================================
set client_min_messages = notice;

\set O1  '00000000-0000-0000-0000-00000000a001'
\set S1  '00000000-0000-0000-0000-00000000b001'
\set S2  '00000000-0000-0000-0000-00000000b002'
\set S3  '00000000-0000-0000-0000-00000000b003'
\set adm '00000000-0000-0000-0000-00000000c001'
\set ed  '00000000-0000-0000-0000-00000000c002'
\set vw  '00000000-0000-0000-0000-00000000c003'
\set cl  '00000000-0000-0000-0000-00000000c004'
\set vnd '00000000-0000-0000-0000-00000000c005'
\set mb  '00000000-0000-0000-0000-00000000c006'
\set T1  '00000000-0000-0000-0000-00000000d001'
\set T2  '00000000-0000-0000-0000-00000000d002'
\set T3  '00000000-0000-0000-0000-00000000d003'
\set T4  '00000000-0000-0000-0000-00000000d004'
\set T5  '00000000-0000-0000-0000-00000000d005'
\set T6  '00000000-0000-0000-0000-00000000d006'
\set T4X '00000000-0000-0000-0000-00000000d104'

\set c_adm '{"sub":"00000000-0000-0000-0000-00000000c001","role":"authenticated"}'
\set c_ed  '{"sub":"00000000-0000-0000-0000-00000000c002","role":"authenticated"}'
\set c_vw  '{"sub":"00000000-0000-0000-0000-00000000c003","role":"authenticated"}'

-- -----------------------------------------------------------------------------
-- 検証ヘルパ
-- -----------------------------------------------------------------------------
create schema if not exists test;
grant usage on schema test to authenticated, service_role;
create table test.results (seq serial primary key, label text, ok boolean, got text, want text);

-- 結果の記録（definer: authenticated / service_role の視点のままでも記録できる）
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

-- 残っている行を数える（definer: RLS に隠されずに数える）
create or replace function test.space_rows(p_space uuid)
returns text language sql stable security definer set search_path = public as $$
  select format('spaces=%s tasks=%s pricing=%s',
                (select count(*) from public.spaces where id = p_space),
                (select count(*) from public.tasks where space_id = p_space),
                (select count(*) from public.task_pricing where space_id = p_space));
$$;
create or replace function test.task_rows(p_task uuid)
returns text language sql stable security definer set search_path = public as $$
  select format('tasks=%s pricing=%s',
                (select count(*) from public.tasks where id = p_task),
                (select count(*) from public.task_pricing where task_id = p_task));
$$;

-- 関数を作る migration が「既定の実行権を付けない」に変わっても使えるよう、補助関数は明示で grant する
grant execute on all functions in schema test to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- データ（行はどれも space と同じ組織）
-- -----------------------------------------------------------------------------
insert into public.organizations(id, name) values (:'O1', 'o1');
insert into auth.users(id) values (:'adm'), (:'ed'), (:'vw'), (:'cl'), (:'vnd'), (:'mb');
insert into public.org_memberships(org_id, user_id, role) values
  (:'O1', :'adm', 'owner'), (:'O1', :'ed', 'member'), (:'O1', :'vw', 'member'),
  (:'O1', :'cl', 'client'), (:'O1', :'vnd', 'client'), (:'O1', :'mb', 'member');
insert into public.spaces(id, org_id, type, name) values
  (:'S1', :'O1', 'project', 's1'), (:'S2', :'O1', 'project', 's2'), (:'S3', :'O1', 'project', 's3');
insert into public.space_memberships(space_id, user_id, role)
  select s.id, u.user_id, u.role
    from (values (:'S1'::uuid), (:'S2'::uuid), (:'S3'::uuid)) as s(id)
    cross join (values (:'adm'::uuid, 'admin'), (:'ed'::uuid, 'editor'), (:'vw'::uuid, 'viewer'),
                       (:'cl'::uuid, 'client'), (:'vnd'::uuid, 'vendor')) as u(user_id, role);

set role service_role;
insert into public.tasks(id, org_id, space_id, title, status, created_by) values
  (:'T1', :'O1', :'S1', 't1', 'todo', :'ed'), (:'T2', :'O1', :'S1', 't2', 'todo', :'ed'),
  (:'T3', :'O1', :'S1', 't3', 'todo', :'ed'), (:'T4', :'O1', :'S1', 't4', 'todo', :'ed'),
  (:'T5', :'O1', :'S2', 't5', 'todo', :'ed'), (:'T6', :'O1', :'S3', 't6', 'todo', :'ed');
insert into public.task_pricing(org_id, space_id, task_id)
  select org_id, space_id, id from public.tasks;
reset role;

-- -----------------------------------------------------------------------------
-- 関数: 本文に連鎖削除を通す確認が入り、SECURITY DEFINER・search_path = public のまま
-- -----------------------------------------------------------------------------
select test.check('chg_guard_body_lets_cascade_through', (
  select (position('if pg_trigger_depth() > 1' in p.prosrc) > 0)::text
  from pg_proc p where p.oid = 'public.guard_task_pricing_delete()'::regprocedure
), 'true');
select test.check('same_guard_definer_and_search_path', (
  select format('definer=%s config=%s', p.prosecdef::text, array_to_string(p.proconfig, ';'))
  from pg_proc p where p.oid = 'public.guard_task_pricing_delete()'::regprocedure
), 'definer=true config=search_path=public');

-- -----------------------------------------------------------------------------
-- タスク・space を消す（連鎖削除で見積の行も消える）
-- -----------------------------------------------------------------------------
\echo '== delete tasks / spaces (cascade) =='
-- editor が画面と同じ権限（authenticated・RLS を通る）で、見積の行があるタスクを消す
begin;
set local role authenticated;
select set_config('request.jwt.claims', :'c_ed', true);
select test.check('chg_editor_deletes_task_with_pricing', test.flow(
  array[format('delete from public.tasks where id = %L', :'T1')],
  format('select test.task_rows(%L)', :'T1')), 'ok:tasks=0 pricing=0');
-- viewer はタスクを消せない（タスクの表の権限で止まる）ので、見積の行も残る
select set_config('request.jwt.claims', :'c_vw', true);
select test.check('same_viewer_cannot_delete_task_with_pricing', test.flow(
  array[format('delete from public.tasks where id = %L', :'T2')],
  format('select test.task_rows(%L)', :'T2')), 'ok:tasks=1 pricing=1');
commit;

-- admin が画面と同じ権限で、見積の行がある space を消す
begin;
set local role authenticated;
select set_config('request.jwt.claims', :'c_adm', true);
select test.check('chg_admin_deletes_space_with_pricing', test.flow(
  array[format('delete from public.spaces where id = %L', :'S2')],
  format('select test.space_rows(%L)', :'S2')), 'ok:spaces=0 tasks=0 pricing=0');
commit;

-- SQL エディタ（postgres・ログイン中の人なし）で、見積の行がある space を消す
begin;
select set_config('request.jwt.claims', '', true);
select set_config('request.jwt.claim.sub', '', true);
select test.check('chg_sql_editor_deletes_space_with_pricing', test.flow(
  array[format('delete from public.spaces where id = %L', :'S3')],
  format('select test.space_rows(%L)', :'S3')), 'ok:spaces=0 tasks=0 pricing=0');
commit;

-- -----------------------------------------------------------------------------
-- 見積の行だけを消す（元のタスクと space はある）: admin / editor / service_role だけが消せる
--   postgres のまま名乗る人だけを切り替える（見張りの判定だけを見る）
-- -----------------------------------------------------------------------------
\echo '== delete only a pricing row (guard) =='
begin;
select set_config('request.jwt.claims', '', true);
select set_config('request.jwt.claim.sub', :'vw', true);
select test.check('same_viewer_cannot_delete_pricing_row', test.try(format(
  'delete from public.task_pricing where task_id = %L', :'T3')),
  'like:err:P0001:permission denied: only admin/editor can delete task pricing%');
select set_config('request.jwt.claim.sub', :'cl', true);
select test.check('same_client_cannot_delete_pricing_row', test.try(format(
  'delete from public.task_pricing where task_id = %L', :'T3')),
  'like:err:P0001:permission denied: only admin/editor can delete task pricing%');
select set_config('request.jwt.claim.sub', :'vnd', true);
select test.check('same_vendor_cannot_delete_pricing_row', test.try(format(
  'delete from public.task_pricing where task_id = %L', :'T3')),
  'like:err:P0001:permission denied: only admin/editor can delete task pricing%');
select set_config('request.jwt.claim.sub', '', true);
select test.check('same_nobody_logged_in_cannot_delete_pricing_row', test.try(format(
  'delete from public.task_pricing where task_id = %L', :'T3')),
  'like:err:P0001:permission denied: only admin/editor can delete task pricing%');
-- space の役割が無い社内メンバーは、1つの文でタスクを書き換えながらでも、見積の行を消せない
select set_config('request.jwt.claim.sub', :'mb', true);
select test.check('same_member_without_space_role_cannot_delete_pricing_while_updating_task', test.try(format(
  'with moved as (update public.tasks set id = %L where id = %L returning id) '
  'delete from public.task_pricing where task_id = %L and exists (select 1 from moved)', :'T4X', :'T4', :'T4')),
  'like:err:P0001:permission denied: only admin/editor can delete task pricing%');
select set_config('request.jwt.claim.sub', :'ed', true);
select test.check('same_editor_can_delete_pricing_row', test.try(format(
  'delete from public.task_pricing where task_id = %L', :'T3')), 'ok:1');
select set_config('request.jwt.claim.sub', :'adm', true);
select test.check('same_admin_can_delete_pricing_row', test.try(format(
  'delete from public.task_pricing where task_id = %L', :'T3')), 'ok:1');
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select test.check('same_service_role_can_delete_pricing_row', test.try(format(
  'delete from public.task_pricing where task_id = %L', :'T3')), 'ok:1');
reset role;
commit;

-- 書き込みの見張り（guard_task_pricing_write）は変えない: viewer は見積の行を書けない
begin;
select set_config('request.jwt.claim.sub', :'vw', true);
select test.check('same_write_guard_blocks_viewer', test.try(format(
  'update public.task_pricing set cost_hours = 1 where task_id = %L', :'T4')),
  'like:err:P0001:permission denied: only admin/editor/vendor can modify task pricing%');
commit;

-- 巻き戻したので、行は減っていない
select test.check('same_checks_left_no_change', (
  select format('spaces=%s tasks=%s pricing=%s',
                (select count(*) from public.spaces), (select count(*) from public.tasks), (select count(*) from public.task_pricing))
), 'spaces=3 tasks=6 pricing=6');

-- 二要素認証の RESTRICTIVE: RLS が有効な public の全表にある
select test.check('same_mfa_on_all_rls_tables', (
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
    raise exception 'TASK PRICING GUARD CHECKS FAILED (% failures)', v_fail;
  end if;
end $$;
select 'TASK PRICING GUARD CHECKS PASSED' as result;
