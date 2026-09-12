-- =============================================================================
-- 社内専用の記録を新しい表だけに置く（*_internal_metrics_drop_old_columns.sql）の挙動検証
-- 前提: run_internal_metrics_drop_old_columns.sh が _local_bootstrap → Supabase の権限の代役 → migrations →
--   internal_metrics_drop_old_columns_seed.sql → 本 migration（RED=1 のときは本 migration だけ流さない）。
--   データと人物は seed のとおり。
-- 画面と同じ書き込みは set role authenticated ＋ request.jwt.claims（RLS を通る）。サーバーは set role service_role。
--
-- label:
--   chg_*    本 migration で変わるもの（適用前は FAIL・適用後は PASS であるべき）
--   same_*   本 migration で変えないもの（両方で PASS）
-- 出力: PASS[label] / FAIL[label]。最後に FAIL が 0 件なら "DROP OLD COLUMNS CHECKS PASSED"。
--   1件でもあれば例外で終了する。書き込みはサブトランザクションで実行し、必ず巻き戻す（各 assert は独立）。
-- =============================================================================
set client_min_messages = notice;

\set O1 '00000000-0000-0000-0000-00000000a001'
\set S1 '00000000-0000-0000-0000-00000000b001'
\set S2 '00000000-0000-0000-0000-00000000b002'
\set S9 '00000000-0000-0000-0000-00000000b009'
\set T1 '00000000-0000-0000-0000-00000000d001'
\set T2 '00000000-0000-0000-0000-00000000d002'
\set c_own '{"sub":"00000000-0000-0000-0000-00000000c001","role":"authenticated"}'
\set c_ed '{"sub":"00000000-0000-0000-0000-00000000c002","role":"authenticated"}'
\set c_vw '{"sub":"00000000-0000-0000-0000-00000000c003","role":"authenticated"}'
\set c_nm '{"sub":"00000000-0000-0000-0000-00000000c004","role":"authenticated"}'
\set c_cl '{"sub":"00000000-0000-0000-0000-00000000c005","role":"authenticated"}'
-- 本 migration の見張りの本文の md5
\set md5_guard '0cebbb07f3cb2a0ea54f81fbde1c99b3'

-- -----------------------------------------------------------------------------
-- 検証ヘルパ
-- -----------------------------------------------------------------------------
create schema if not exists test;
grant usage on schema test to anon, authenticated, service_role;
create table test.results (seq serial primary key, label text, ok boolean, got text, want text);

-- 結果の記録（definer: どの役割の視点のままでも記録できる）
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

-- 呼んだ人の権限で SQL を順に流し、最後に p_probe の値を返して必ず巻き戻す（ok:<値> / err:<SQLSTATE>:<メッセージ>）
create or replace function test.flow(p_sqls text[], p_probe text)
returns text language plpgsql security invoker as $$
declare s text; v text; v_state text; v_detail text; v_msg text;
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

-- 行を RLS に隠されずに読む
create or replace function test.space_state(p_space uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select s.name || '/' || s.agency_mode::text from public.spaces s where s.id = p_space), '(no row)')
$$;

create or replace function test.new_tables(p_task uuid, p_space uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select m.actual_hours::text from public.task_internal_metrics m where m.task_id = p_task), 'none')
         || ' / ' || coalesce((select a.default_margin_rate::text || ' ' || a.vendor_settings::text
                                 from public.space_agency_settings a where a.space_id = p_space), 'none')
$$;

-- 関数を作る migration が「既定の実行権を付けない」ので、補助関数は明示で grant する
grant execute on all functions in schema test to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 形: 古い列・つなぎ・見張り
-- -----------------------------------------------------------------------------
\echo '== shape =='
select test.check('chg_old_columns_gone', (
  select coalesce(string_agg(c.relname || '.' || a.attname, ',' order by c.relname, a.attname), 'none')
    from pg_attribute a join pg_class c on c.oid = a.attrelid
   where not a.attisdropped
     and ((c.oid = 'public.tasks'::regclass and a.attname = 'actual_hours')
       or (c.oid = 'public.spaces'::regclass and a.attname in ('default_margin_rate', 'vendor_settings')))
), 'none');

select test.check('chg_bridges_gone', (
  select ((select count(*) from pg_trigger
            where tgname in ('trg_bridge_task_actual_hours', 'trg_bridge_space_agency_settings') and not tgisinternal)
          + (select count(*) from pg_proc
              where oid in (coalesce(to_regprocedure('public.bridge_task_actual_hours()'), 0),
                            coalesce(to_regprocedure('public.bridge_space_agency_settings()'), 0))))::text
), '0');

select test.check('chg_guard_rebuilt', (
  select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.guard_agency_settings()')
), :'md5_guard');

select test.check('chg_guard_trigger_covers_insert', (
  select coalesce((select format('%s:%s', t.tgenabled::text,
                                 (pg_get_triggerdef(t.oid) like '%BEFORE INSERT OR UPDATE OF agency_mode ON public.spaces FOR EACH ROW EXECUTE FUNCTION %guard_agency_settings()')::text)
                     from pg_trigger t
                    where t.tgrelid = 'public.spaces'::regclass and t.tgname = 'trg_guard_agency_settings' and not t.tgisinternal), 'none')
), 'O:true');

-- 見張りの DEFINER・search_path・実行権は変えない
select test.check('same_guard_rights', (
  select format('definer=%s config=%s exec=%s/%s/%s/%s', p.prosecdef::text, array_to_string(p.proconfig, ';'),
                has_function_privilege('public', p.oid, 'execute')::text,
                has_function_privilege('anon', p.oid, 'execute')::text,
                has_function_privilege('authenticated', p.oid, 'execute')::text,
                has_function_privilege('service_role', p.oid, 'execute')::text)
    from pg_proc p where p.oid = to_regprocedure('public.guard_agency_settings()')
), 'definer=true config=search_path=public exec=true/true/true/true');

-- 古い列に入れた値は、新しい表に残っている
select test.check('same_values_kept_in_new_tables', test.new_tables(:'T1', :'S1'),
  '3 / 20.00 {"show_client_name": true, "allow_client_comments": false}');

-- tasks の行の型を受け取る関数は、列が減っても動く
select test.check('same_task_row_function_runs', test.flow(array[]::text[],
  format('select public._task_is_mirror_target(t)::text from public.tasks t where t.id = %L', :'T1')), 'like:ok:%');

-- -----------------------------------------------------------------------------
-- 古い列は読めない・書けない。新しい表は今までどおり読み書きできる
-- -----------------------------------------------------------------------------
\echo '== old columns / new tables =='
select test.check('chg_old_task_column_not_readable', test.flow(array[]::text[],
  format('select actual_hours::text from public.tasks where id = %L', :'T1')), 'like:err:42703:%');

begin;
set local role service_role;
select test.check('chg_old_space_column_not_writable', test.flow(
  array[format('update public.spaces set default_margin_rate = 30 where id = %L', :'S1')],
  format('select test.new_tables(%L, %L)', :'T1', :'S1')), 'like:err:42703:%');
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims', :'c_ed', true);
select test.check('same_editor_writes_new_tables', test.flow(
  array[format('insert into public.task_internal_metrics(task_id, actual_hours) values (%L, 5) on conflict (task_id) do update set actual_hours = excluded.actual_hours', :'T2'),
        format('insert into public.space_agency_settings(space_id, default_margin_rate) values (%L, 25) on conflict (space_id) do update set default_margin_rate = excluded.default_margin_rate', :'S1')],
  format('select test.new_tables(%L, %L)', :'T2', :'S1')),
  'ok:5 / 25.00 {"show_client_name": true, "allow_client_comments": false}');
commit;

-- -----------------------------------------------------------------------------
-- 代理店モード: 決められるのはサーバーと、その space の admin / editor だけ（作るときも）
-- -----------------------------------------------------------------------------
\echo '== agency_mode guard =='
begin;
set local role authenticated;
select set_config('request.jwt.claims', :'c_ed', true);
select test.check('same_editor_turns_agency_mode_on', test.flow(
  array[format('update public.spaces set agency_mode = true where id = %L', :'S1')],
  format('select test.space_state(%L)', :'S1')), 'ok:s1/true');
select set_config('request.jwt.claims', :'c_own', true);
select test.check('same_admin_turns_agency_mode_on', test.flow(
  array[format('update public.spaces set agency_mode = true where id = %L', :'S1')],
  format('select test.space_state(%L)', :'S1')), 'ok:s1/true');
-- 閲覧者と相手先は、そもそも space を書き換えられない（0 行）
select set_config('request.jwt.claims', :'c_vw', true);
select test.check('same_viewer_cannot_change_agency_mode', test.flow(
  array[format('update public.spaces set agency_mode = true where id = %L', :'S1')],
  format('select test.space_state(%L)', :'S1')), 'ok:s1/false');
select set_config('request.jwt.claims', :'c_cl', true);
select test.check('same_client_cannot_change_agency_mode', test.flow(
  array[format('update public.spaces set agency_mode = true where id = %L', :'S1')],
  format('select test.space_state(%L)', :'S1')), 'ok:s1/false');
-- space に行の無い社内メンバーは、space は書き換えられても、代理店モードは見張りが止める（名前は変えられる）
select set_config('request.jwt.claims', :'c_nm', true);
select test.check('same_member_without_row_cannot_change_agency_mode', test.flow(
  array[format('update public.spaces set agency_mode = true where id = %L', :'S1')],
  format('select test.space_state(%L)', :'S1')), 'like:err:P0001:permission denied: only admin/editor can update agency settings%');
select test.check('same_member_without_row_renames_space', test.flow(
  array[format('update public.spaces set name = %L where id = %L', 's1-renamed', :'S1')],
  format('select test.space_state(%L)', :'S1')), 'ok:s1-renamed/false');
-- 作るとき: 社内メンバーは、代理店モードの space は作れない（普通の space は作れる）
select set_config('request.jwt.claims', :'c_ed', true);
select test.check('chg_member_cannot_create_agency_space', test.flow(
  array[format('insert into public.spaces(id, org_id, type, name, agency_mode) values (%L, %L, %L, %L, true)', :'S9', :'O1', 'project', 's9')],
  format('select test.space_state(%L)', :'S9')), 'like:err:P0001:permission denied: only admin/editor can update agency settings%');
select test.check('same_member_creates_normal_space', test.flow(
  array[format('insert into public.spaces(id, org_id, type, name) values (%L, %L, %L, %L)', :'S9', :'O1', 'project', 's9')],
  format('select test.space_state(%L)', :'S9')), 'ok:s9/false');
-- 画面の作り方（rpc_create_space_with_preset）は今までどおり
select set_config('request.jwt.claims', :'c_own', true);
select test.check('same_rpc_create_space_with_preset', test.flow(
  array[format('select public.rpc_create_space_with_preset(%L, %L)', :'O1', 's-rpc')],
  format('select count(*)::text || %L || bool_or(agency_mode)::text from public.spaces where org_id = %L and name = %L', '/', :'O1', 's-rpc')),
  'ok:1/false');
commit;

-- サーバー（service_role）は、代理店モードの space を作れて、切り替えもできる
begin;
set local role service_role;
select test.check('same_service_role_creates_agency_space', test.flow(
  array[format('insert into public.spaces(id, org_id, type, name, agency_mode) values (%L, %L, %L, %L, true)', :'S9', :'O1', 'project', 's9')],
  format('select test.space_state(%L)', :'S9')), 'ok:s9/true');
select test.check('same_service_role_turns_agency_mode_off', test.flow(
  array[format('update public.spaces set agency_mode = false where id = %L', :'S2')],
  format('select test.space_state(%L)', :'S2')), 'ok:s2/false');
commit;

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
    raise exception 'DROP OLD COLUMNS CHECKS FAILED (% failures)', v_fail;
  end if;
end $$;
select 'DROP OLD COLUMNS CHECKS PASSED' as result;
