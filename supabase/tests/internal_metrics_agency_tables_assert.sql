-- =============================================================================
-- 社内専用の新表2つ（*_internal_metrics_agency_tables.sql）の挙動検証
--   task_internal_metrics  タスクの社内専用の記録（実績工数）
--   space_agency_settings  space の代理店設定（既定の利益率・協力会社向けの表示設定）
-- 前提: run_internal_metrics_agency_tables.sh が _local_bootstrap → Supabase の権限の代役 → migrations →
--   internal_metrics_agency_tables_seed.sql → 本 migration（RED=1 のときは本 migration だけ流さない）。
--   データと人物は seed のとおり。
-- 画面と同じ読み書きは set role authenticated ＋ request.jwt.claims（RLS を通る）。
-- 新表の読み書きは test.val / test.try / test.flow を通す（新表が無い RED でもエラーで止まらず FAIL として数える）。
--
-- label:
--   chg_*    本 migration で変わるもの（適用前は FAIL・適用後は PASS であるべき）
--   same_*   本 migration で変えないもの（両方で PASS）
-- 出力: PASS[label] / FAIL[label]。最後に FAIL が 0 件なら "INTERNAL METRICS AGENCY TABLES CHECKS PASSED"。
--   1件でもあれば例外で終了する。書き込みはサブトランザクションで実行し、必ず巻き戻す（各 assert は独立）。
-- =============================================================================
set client_min_messages = notice;

\set O1  '00000000-0000-0000-0000-00000000a001'
\set O2  '00000000-0000-0000-0000-00000000a002'
\set S1  '00000000-0000-0000-0000-00000000b001'
\set S2  '00000000-0000-0000-0000-00000000b002'
\set S3  '00000000-0000-0000-0000-00000000b003'
\set T1  '00000000-0000-0000-0000-00000000d001'
\set T2  '00000000-0000-0000-0000-00000000d002'
\set T3  '00000000-0000-0000-0000-00000000d003'
\set adm '00000000-0000-0000-0000-00000000c001'
\set ed  '00000000-0000-0000-0000-00000000c002'
\set vw  '00000000-0000-0000-0000-00000000c003'
\set cl  '00000000-0000-0000-0000-00000000c004'
\set vnd '00000000-0000-0000-0000-00000000c005'
\set mb  '00000000-0000-0000-0000-00000000c006'
\set o2  '00000000-0000-0000-0000-00000000c007'

\set c_adm '{"sub":"00000000-0000-0000-0000-00000000c001","role":"authenticated"}'
\set c_ed  '{"sub":"00000000-0000-0000-0000-00000000c002","role":"authenticated"}'
\set c_vw  '{"sub":"00000000-0000-0000-0000-00000000c003","role":"authenticated"}'
\set c_cl  '{"sub":"00000000-0000-0000-0000-00000000c004","role":"authenticated"}'
\set c_vnd '{"sub":"00000000-0000-0000-0000-00000000c005","role":"authenticated"}'
\set c_mb  '{"sub":"00000000-0000-0000-0000-00000000c006","role":"authenticated"}'
\set c_o2  '{"sub":"00000000-0000-0000-0000-00000000c007","role":"authenticated"}'
\set c_ed_aal1 '{"sub":"00000000-0000-0000-0000-00000000c002","role":"authenticated","aal":"aal1"}'
\set c_ed_aal2 '{"sub":"00000000-0000-0000-0000-00000000c002","role":"authenticated","aal":"aal2"}'

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

-- 呼んだ人の権限で、値を1つ返す SQL を流し、値を返して必ず巻き戻す（ok:<値> / err:<SQLSTATE>:<メッセージ>）
create or replace function test.val(p_sql text)
returns text language plpgsql security invoker as $$
declare v text; v_state text; v_detail text; v_msg text;
begin
  begin
    execute p_sql into v;
    raise exception 'test_rollback' using errcode = 'TR001', detail = coalesce(v, 'NULL');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail, v_msg = message_text;
    if v_state = 'TR001' then return 'ok:' || v_detail; end if;
    return 'err:' || v_state || ':' || v_msg;
  end;
end $$;

-- 呼んだ人の権限で SQL を1つ流し、影響した行数を返して必ず巻き戻す（ok:<行数> / err:<SQLSTATE>:<メッセージ>）
create or replace function test.try(p_sql text)
returns text language plpgsql security invoker as $$
declare v_n bigint; v_state text; v_detail text; v_msg text;
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

-- 新表の中身を、RLS に隠されずに読む（definer・plpgsql なので、新表が無い RED では呼んだときにエラーになる）
create or replace function test.metrics_hours(p_task uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  select coalesce(m.actual_hours::text, '(null)') into v from public.task_internal_metrics m where m.task_id = p_task;
  if not found then return '(no row)'; end if;
  return v;
end $$;
create or replace function test.agency_margin(p_space uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  select coalesce(a.default_margin_rate::text, '(null)') into v from public.space_agency_settings a where a.space_id = p_space;
  if not found then return '(no row)'; end if;
  return v;
end $$;
create or replace function test.space_rows(p_space uuid)
returns text language plpgsql stable security definer set search_path = public as $$
begin
  return format('metrics=%s agency=%s',
                (select count(*) from public.task_internal_metrics m where m.space_id = p_space),
                (select count(*) from public.space_agency_settings a where a.space_id = p_space));
end $$;

-- 関数を作る migration が「既定の実行権を付けない」ので、補助関数は明示で grant する
grant execute on all functions in schema test to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 形: 表・RLS・ポリシー・二要素・外部キー・表の権限・トリガー
-- -----------------------------------------------------------------------------
\echo '== shape =='
select test.check('chg_tables_rls_enabled', (
  select coalesce(string_agg(c.relname || '=' || c.relrowsecurity, ',' order by c.relname collate "C"), 'none')
  from pg_class c
  where c.oid in (to_regclass('public.task_internal_metrics'), to_regclass('public.space_agency_settings'))
), 'space_agency_settings=true,task_internal_metrics=true');

select test.check('chg_policies', (
  select coalesce(string_agg(tablename || ':' || policyname || ':' || cmd || ':' || permissive, ','
                             order by tablename collate "C", policyname collate "C"), 'none')
  from pg_policies
  where schemaname = 'public' and tablename in ('task_internal_metrics', 'space_agency_settings')
), 'space_agency_settings:mfa_required_when_enrolled:ALL:RESTRICTIVE,'
   'space_agency_settings:space_agency_settings_insert_member:INSERT:PERMISSIVE,'
   'space_agency_settings:space_agency_settings_select_member:SELECT:PERMISSIVE,'
   'space_agency_settings:space_agency_settings_update_member:UPDATE:PERMISSIVE,'
   'task_internal_metrics:mfa_required_when_enrolled:ALL:RESTRICTIVE,'
   'task_internal_metrics:task_internal_metrics_delete_member:DELETE:PERMISSIVE,'
   'task_internal_metrics:task_internal_metrics_insert_member:INSERT:PERMISSIVE,'
   'task_internal_metrics:task_internal_metrics_select_member:SELECT:PERMISSIVE,'
   'task_internal_metrics:task_internal_metrics_update_member:UPDATE:PERMISSIVE');

select test.check('chg_foreign_keys', (
  select coalesce(string_agg(conrelid::regclass::text || ':' || conname || ':' || convalidated || ':' || pg_get_constraintdef(oid), ','
                             order by conrelid::regclass::text collate "C", conname collate "C"), 'none')
  from pg_constraint
  where contype = 'f' and conrelid in (to_regclass('public.task_internal_metrics'), to_regclass('public.space_agency_settings'))
), 'space_agency_settings:space_agency_settings_org_id_fkey:true:FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,'
   'space_agency_settings:space_agency_settings_space_org_fkey:true:FOREIGN KEY (space_id, org_id) REFERENCES spaces(id, org_id) ON DELETE CASCADE,'
   'task_internal_metrics:task_internal_metrics_org_id_fkey:true:FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,'
   'task_internal_metrics:task_internal_metrics_space_org_fkey:true:FOREIGN KEY (space_id, org_id) REFERENCES spaces(id, org_id) ON DELETE CASCADE,'
   'task_internal_metrics:task_internal_metrics_task_id_fkey:true:FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE');

-- 表の権限（s=SELECT i=INSERT u=UPDATE d=DELETE t=TRUNCATE r=REFERENCES g=TRIGGER・無しは -）
select test.check('chg_table_privileges', (
  select string_agg(format('%s:%s:%s', t.tbl, r.role, (
           select coalesce(string_agg(p.k, '' order by p.o), '-')
             from (values ('SELECT', 's', 1), ('INSERT', 'i', 2), ('UPDATE', 'u', 3), ('DELETE', 'd', 4),
                          ('TRUNCATE', 't', 5), ('REFERENCES', 'r', 6), ('TRIGGER', 'g', 7)) as p(name, k, o)
            where has_table_privilege(r.role, t.oid, p.name))), ',' order by t.o, r.o)
  from (values ('metrics', to_regclass('public.task_internal_metrics'), 1),
               ('agency', to_regclass('public.space_agency_settings'), 2)) as t(tbl, oid, o)
  cross join (values ('public', 1), ('anon', 2), ('authenticated', 3), ('service_role', 4)) as r(role, o)
  where t.oid is not null
), 'metrics:public:-,metrics:anon:-,metrics:authenticated:siud,metrics:service_role:siud,'
   'agency:public:-,agency:anon:-,agency:authenticated:siu,agency:service_role:siud');

select test.check('chg_triggers', (
  select coalesce(string_agg(t.tgrelid::regclass::text || ':' || t.tgname || ':' || t.tgenabled::text, ','
                             order by t.tgrelid::regclass::text collate "C", t.tgname collate "C"), 'none')
  from pg_trigger t
  where not t.tgisinternal
    and (t.tgrelid in (to_regclass('public.task_internal_metrics'), to_regclass('public.space_agency_settings'))
         or t.tgname in ('trg_bridge_task_actual_hours', 'trg_bridge_space_agency_settings'))
), 'space_agency_settings:trg_space_agency_settings_fill_scope:O,spaces:trg_bridge_space_agency_settings:O,'
   'task_internal_metrics:trg_task_internal_metrics_fill_scope:O,tasks:trg_bridge_task_actual_hours:O');

-- 二要素認証の RESTRICTIVE: RLS が有効な public の全表にある（新表も）
select test.check('same_mfa_on_all_rls_tables', (
  select count(*)::text from pg_tables t
  where t.schemaname = 'public' and t.rowsecurity
    and not exists (select 1 from pg_policies p
                    where p.schemaname = 'public' and p.tablename = t.tablename
                      and p.policyname = 'mfa_required_when_enrolled')
), '0');

-- -----------------------------------------------------------------------------
-- 埋め戻し: 古い列に値があった行が新表にある（seed: T1 = 3.5・T3 = 1・S1 = 20 と表示設定）
-- -----------------------------------------------------------------------------
\echo '== backfill =='
select test.check('chg_backfill_metrics', test.val(
  'select string_agg(task_id::text || ''='' || actual_hours::text, '','' order by task_id) from public.task_internal_metrics'),
  'ok:' || :'T1' || '=3.5,' || :'T3' || '=1');
select test.check('chg_backfill_agency', test.val(
  'select string_agg(space_id::text || ''='' || coalesce(default_margin_rate::text, ''-'') || ''/'' || '
  '(vendor_settings = ''{"show_client_name": true, "allow_client_comments": false}''::jsonb)::text, '','' order by space_id) '
  'from public.space_agency_settings'),
  'ok:' || :'S1' || '=20.00/true');

-- 組織と space は元の行から写す（書き手が渡した値は使わない）
select test.check('chg_metrics_org_space_come_from_task', test.flow(
  array[format('insert into public.task_internal_metrics(task_id, org_id, space_id, actual_hours) values (%L, %L, %L, 2)',
               :'T2', :'O2', :'S2')],
  format('select org_id::text || ''/'' || space_id::text from public.task_internal_metrics where task_id = %L', :'T2')),
  'ok:' || :'O1' || '/' || :'S1');
select test.check('chg_agency_org_comes_from_space', test.flow(
  array[format('insert into public.space_agency_settings(space_id, org_id, default_margin_rate) values (%L, %L, 10)',
               :'S2', :'O2')],
  format('select org_id::text from public.space_agency_settings where space_id = %L', :'S2')),
  'ok:' || :'O1');

-- -----------------------------------------------------------------------------
-- task_internal_metrics: 読み = その space で社内扱いの社内メンバー（app_is_space_internal） / 書き = app_can_write_space（社内の editor・admin。
--   space に行が無い社内メンバーは editor 扱い）。相手先・協力会社・未ログイン・別の組織は読めない
-- -----------------------------------------------------------------------------
\echo '== task_internal_metrics =='
begin;
set local role authenticated;
select set_config('request.jwt.claims', :'c_ed', true);
select test.check('chg_metrics_editor_reads', test.val('select count(*)::text from public.task_internal_metrics'), 'ok:2');
select test.check('chg_metrics_editor_inserts', test.try(format(
  'insert into public.task_internal_metrics(task_id, actual_hours) values (%L, 4)', :'T2')), 'ok:1');
select test.check('chg_metrics_editor_updates', test.try(format(
  'update public.task_internal_metrics set actual_hours = 6 where task_id = %L', :'T1')), 'ok:1');
select test.check('chg_metrics_editor_deletes', test.try(format(
  'delete from public.task_internal_metrics where task_id = %L', :'T1')), 'ok:1');

select set_config('request.jwt.claims', :'c_vw', true);
select test.check('chg_metrics_viewer_reads', test.val('select count(*)::text from public.task_internal_metrics'), 'ok:2');
select test.check('chg_metrics_viewer_cannot_insert', test.try(format(
  'insert into public.task_internal_metrics(task_id, actual_hours) values (%L, 4)', :'T2')), 'like:err:42501:%');
select test.check('chg_metrics_viewer_cannot_update', test.try(format(
  'update public.task_internal_metrics set actual_hours = 6 where task_id = %L', :'T1')), 'ok:0');

select set_config('request.jwt.claims', :'c_mb', true);
select test.check('chg_metrics_member_without_space_role_reads', test.val('select count(*)::text from public.task_internal_metrics'), 'ok:2');
select test.check('chg_metrics_member_without_space_role_inserts', test.try(format(
  'insert into public.task_internal_metrics(task_id, actual_hours) values (%L, 4)', :'T2')), 'ok:1');

select set_config('request.jwt.claims', :'c_cl', true);
select test.check('chg_metrics_client_reads_nothing', test.val('select count(*)::text from public.task_internal_metrics'), 'ok:0');
select test.check('chg_metrics_client_cannot_insert', test.try(format(
  'insert into public.task_internal_metrics(task_id, actual_hours) values (%L, 4)', :'T2')), 'like:err:42501:%');

select set_config('request.jwt.claims', :'c_vnd', true);
select test.check('chg_metrics_vendor_reads_nothing', test.val('select count(*)::text from public.task_internal_metrics'), 'ok:0');
select test.check('chg_metrics_vendor_cannot_insert', test.try(format(
  'insert into public.task_internal_metrics(task_id, actual_hours) values (%L, 4)', :'T2')), 'like:err:42501:%');
-- 協力会社は古い列（tasks.actual_hours）も書けない（tasks の書き込みは社内の編集者だけ）
select test.check('same_vendor_cannot_write_old_actual_hours', test.try(format(
  'update public.tasks set actual_hours = 9 where id = %L', :'T1')), 'ok:0');

select set_config('request.jwt.claims', :'c_o2', true);
select test.check('chg_metrics_other_org_reads_nothing', test.val('select count(*)::text from public.task_internal_metrics'), 'ok:0');
commit;

begin;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select test.check('chg_metrics_anon_cannot_read', test.val('select count(*)::text from public.task_internal_metrics'), 'like:err:42501:%');
commit;

-- 更新で組織と space を別の値に書き換えても、元の行（tasks・spaces）の値に戻る（両方の表の更新の経路）
select test.check('chg_update_org_space_come_from_original_rows', test.flow(
  array[format('update public.task_internal_metrics set org_id = %L, space_id = %L where task_id = %L', :'O2', :'S2', :'T1'),
        format('update public.space_agency_settings set org_id = %L where space_id = %L', :'O2', :'S1')],
  format('select (select org_id::text || ''/'' || space_id::text from public.task_internal_metrics where task_id = %L) '
         '|| '' '' || (select org_id::text from public.space_agency_settings where space_id = %L)', :'T1', :'S1')),
  'ok:' || :'O1' || '/' || :'S1' || ' ' || :'O1');

-- 別の組織のタスクを指す記録は作れない（組織と space はタスクから写すので、その組織の編集者でなければ断られる）
--   別の組織（O2）の space S4 とタスク T4 はこの取引の中だけで作り、最後に巻き戻す
begin;
insert into public.spaces(id, org_id, type, name) values
  ('00000000-0000-0000-0000-00000000b004', :'O2', 'project', 's4');
set local role service_role;
insert into public.tasks(id, org_id, space_id, title, status, created_by) values
  ('00000000-0000-0000-0000-00000000d004', :'O2', '00000000-0000-0000-0000-00000000b004', 't4', 'todo', :'o2');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', :'c_ed', true);
select test.try(format('insert into public.task_internal_metrics(task_id, org_id, space_id, actual_hours) values (%L, %L, %L, 1)',
                       '00000000-0000-0000-0000-00000000d004', :'O1', :'S1')) as other_org_task \gset
rollback;
select test.check('chg_metrics_task_of_other_org_rejected', :'other_org_task', 'like:err:42501:%');

-- -----------------------------------------------------------------------------
-- space_agency_settings: 読み = その space で社内扱いの社内メンバー（app_is_space_internal） / 書き = その space の行が admin か editor の社内メンバー
-- -----------------------------------------------------------------------------
\echo '== space_agency_settings =='
begin;
set local role authenticated;
select set_config('request.jwt.claims', :'c_ed', true);
select test.check('chg_agency_editor_reads', test.val('select count(*)::text from public.space_agency_settings'), 'ok:1');
select test.check('chg_agency_editor_updates', test.try(format(
  'update public.space_agency_settings set default_margin_rate = 25 where space_id = %L', :'S1')), 'ok:1');
-- S2 には ed の行が無いので、S2 の設定は作れない
select test.check('chg_agency_editor_without_row_cannot_insert', test.try(format(
  'insert into public.space_agency_settings(space_id, default_margin_rate) values (%L, 10)', :'S2')), 'like:err:42501:%');

select set_config('request.jwt.claims', :'c_adm', true);
select test.check('chg_agency_admin_updates', test.try(format(
  'update public.space_agency_settings set default_margin_rate = 25 where space_id = %L', :'S1')), 'ok:1');

select set_config('request.jwt.claims', :'c_vw', true);
select test.check('chg_agency_viewer_reads', test.val('select count(*)::text from public.space_agency_settings'), 'ok:1');
select test.check('chg_agency_viewer_cannot_update', test.try(format(
  'update public.space_agency_settings set default_margin_rate = 25 where space_id = %L', :'S1')), 'ok:0');

select set_config('request.jwt.claims', :'c_mb', true);
select test.check('chg_agency_member_without_space_role_reads', test.val('select count(*)::text from public.space_agency_settings'), 'ok:1');
select test.check('chg_agency_member_without_space_role_cannot_update', test.try(format(
  'update public.space_agency_settings set default_margin_rate = 25 where space_id = %L', :'S1')), 'ok:0');

select set_config('request.jwt.claims', :'c_cl', true);
select test.check('chg_agency_client_reads_nothing', test.val('select count(*)::text from public.space_agency_settings'), 'ok:0');
select set_config('request.jwt.claims', :'c_vnd', true);
select test.check('chg_agency_vendor_reads_nothing', test.val('select count(*)::text from public.space_agency_settings'), 'ok:0');
select set_config('request.jwt.claims', :'c_o2', true);
select test.check('chg_agency_other_org_reads_nothing', test.val('select count(*)::text from public.space_agency_settings'), 'ok:0');
commit;

begin;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select test.check('chg_agency_anon_cannot_read', test.val('select count(*)::text from public.space_agency_settings'), 'like:err:42501:%');
commit;

-- -----------------------------------------------------------------------------
-- 読みも space の役割を見る（app_is_space_internal）: 組織の社内メンバーでも、その space の役割が client / vendor なら
--   その space の行は読めず、書けない（組織の owner でも space の役割が勝つ）。space に行が無ければ社内扱い。
--   古い列（tasks.actual_hours・spaces.default_margin_rate・vendor_settings）にも書けない
--   （書けると、つなぎが新しい表へ写してしまう）。
--   mv = O1 member・S1 vendor / mc = O1 member・S1 client / ow2 = O1 owner・S1 vendor（3人とも S2 には行が無い）
-- -----------------------------------------------------------------------------
\echo '== space role decides reads =='
\set c_mv  '{"sub":"00000000-0000-0000-0000-00000000c008","role":"authenticated"}'
\set c_mc  '{"sub":"00000000-0000-0000-0000-00000000c009","role":"authenticated"}'
\set c_ow2 '{"sub":"00000000-0000-0000-0000-00000000c010","role":"authenticated"}'

create or replace function test.space_role_checks(p_who text, p_s1 uuid, p_s2 uuid, p_t1 uuid, p_t2 uuid)
returns void language plpgsql security invoker as $$
begin
  perform test.check('chg_metrics_' || p_who || '_reads_nothing_in_space', test.val(format(
    'select count(*)::text from public.task_internal_metrics where space_id = %L', p_s1)), 'ok:0');
  perform test.check('chg_metrics_' || p_who || '_reads_space_without_row', test.val(format(
    'select count(*)::text from public.task_internal_metrics where space_id = %L', p_s2)), 'ok:1');
  perform test.check('chg_metrics_' || p_who || '_cannot_insert', test.try(format(
    'insert into public.task_internal_metrics(task_id, actual_hours) values (%L, 4)', p_t2)), 'like:err:42501:%');
  perform test.check('chg_metrics_' || p_who || '_cannot_update', test.try(format(
    'update public.task_internal_metrics set actual_hours = 6 where task_id = %L', p_t1)), 'ok:0');
  perform test.check('chg_agency_' || p_who || '_reads_nothing', test.val(
    'select count(*)::text from public.space_agency_settings'), 'ok:0');
  perform test.check('chg_agency_' || p_who || '_cannot_update', test.try(format(
    'update public.space_agency_settings set default_margin_rate = 25 where space_id = %L', p_s1)), 'ok:0');
  -- つなぎの安全確認: 古い列にも書けない（前から同じ）
  perform test.check('same_' || p_who || '_cannot_write_old_actual_hours', test.try(format(
    'update public.tasks set actual_hours = 9 where id = %L', p_t1)), 'ok:0');
  perform test.check('same_' || p_who || '_cannot_write_old_margin', test.try(format(
    'update public.spaces set default_margin_rate = 30 where id = %L', p_s1)), 'ok:0');
  perform test.check('same_' || p_who || '_cannot_write_old_vendor_settings', test.try(format(
    'update public.spaces set vendor_settings = %L::jsonb where id = %L',
    '{"show_client_name": false, "allow_client_comments": true}', p_s1)), 'ok:0');
end $$;

-- 代理店設定の行が無い space に作れるのは、その space の行が admin / editor の社内メンバーだけ
--   （S1 の行をいったん postgres で消し、人物を切り替えて作ってみる。全部巻き戻す）
create or replace function test.agency_insert_as(p_claims text, p_space uuid)
returns text language plpgsql security invoker as $$
begin
  return test.flow(array[
    format('delete from public.space_agency_settings where space_id = %L', p_space),
    'set local role authenticated',
    format('select set_config(%L, %L, true)', 'request.jwt.claims', p_claims),
    format('insert into public.space_agency_settings(space_id, default_margin_rate) values (%L, 10)', p_space)],
    format('select test.agency_margin(%L)', p_space));
end $$;

grant execute on function test.space_role_checks(text, uuid, uuid, uuid, uuid) to authenticated;

begin;
set local role authenticated;
select set_config('request.jwt.claims', :'c_mv', true);
select test.space_role_checks('member_space_vendor', :'S1', :'S2', :'T1', :'T2');
select set_config('request.jwt.claims', :'c_mc', true);
select test.space_role_checks('member_space_client', :'S1', :'S2', :'T1', :'T2');
select set_config('request.jwt.claims', :'c_ow2', true);
select test.space_role_checks('owner_space_vendor', :'S1', :'S2', :'T1', :'T2');
commit;

select test.check('chg_agency_editor_inserts_when_missing', test.agency_insert_as(:'c_ed', :'S1'), 'ok:10.00');
select test.check('chg_agency_member_space_vendor_cannot_insert', test.agency_insert_as(:'c_mv', :'S1'), 'like:err:42501:%');
select test.check('chg_agency_member_space_client_cannot_insert', test.agency_insert_as(:'c_mc', :'S1'), 'like:err:42501:%');
select test.check('chg_agency_owner_space_vendor_cannot_insert', test.agency_insert_as(:'c_ow2', :'S1'), 'like:err:42501:%');
select test.check('chg_agency_org_client_cannot_insert', test.agency_insert_as(:'c_cl', :'S1'), 'like:err:42501:%');

-- -----------------------------------------------------------------------------
-- つなぎ: 古い列に書くと新表に写る（画面と同じ権限で書く）
-- -----------------------------------------------------------------------------
\echo '== bridge from the old columns =='
begin;
set local role authenticated;
select set_config('request.jwt.claims', :'c_ed', true);
select test.check('chg_old_actual_hours_copies', test.flow(
  array[format('update public.tasks set actual_hours = 5 where id = %L', :'T2')],
  format('select test.metrics_hours(%L)', :'T2')), 'ok:5');
select test.check('chg_old_actual_hours_cleared_copies', test.flow(
  array[format('update public.tasks set actual_hours = null where id = %L', :'T1')],
  format('select test.metrics_hours(%L)', :'T1')), 'ok:(null)');
select test.check('same_editor_updates_task_title', test.try(format(
  'update public.tasks set title = %L where id = %L', 'renamed', :'T1')), 'ok:1');

select set_config('request.jwt.claims', :'c_adm', true);
select test.check('chg_old_agency_columns_copy', test.flow(
  array[format('update public.spaces set default_margin_rate = 30 where id = %L', :'S1')],
  format('select test.agency_margin(%L)', :'S1')), 'ok:30.00');

-- 古い列の代理店設定の見張り（guard_agency_settings）は今までどおり: space に行が無い社内メンバーは変えられない
select set_config('request.jwt.claims', :'c_mb', true);
select test.check('same_old_agency_guard_blocks_member_without_row', test.try(format(
  'update public.spaces set default_margin_rate = 30 where id = %L', :'S1')),
  'like:err:P0001:permission denied: only admin/editor can update agency settings%');
commit;

-- 新しい space を代理店設定つきで作ると、新表にも入る（サーバー）
begin;
set local role service_role;
select test.check('chg_new_space_with_agency_values_copies', test.flow(
  array[format('insert into public.spaces(id, org_id, type, name, default_margin_rate) values (%L, %L, %L, %L, 15)',
               :'S3', :'O1', 'project', 's3')],
  format('select test.agency_margin(%L)', :'S3')), 'ok:15.00');
commit;

-- -----------------------------------------------------------------------------
-- 消す: タスクを消すと記録が消え、space を消すと両方の行が消える（サーバー）
-- -----------------------------------------------------------------------------
\echo '== cascade =='
begin;
set local role service_role;
select test.check('chg_delete_task_removes_metrics', test.flow(
  array[format('delete from public.tasks where id = %L', :'T1')],
  format('select test.metrics_hours(%L)', :'T1')), 'ok:(no row)');
select test.check('chg_delete_space_removes_rows', test.flow(
  array[format('delete from public.spaces where id = %L', :'S1')],
  format('select test.space_rows(%L)', :'S1')), 'ok:metrics=0 agency=0');
commit;

-- -----------------------------------------------------------------------------
-- 二要素認証: 確認済みの認証アプリがある人は、コード入力済み（aal2）でなければ読めない
-- -----------------------------------------------------------------------------
\echo '== mfa =='
begin;
insert into auth.mfa_factors(user_id, status) values (:'ed', 'verified');
set local role authenticated;
select set_config('request.jwt.claims', :'c_ed_aal1', true);
select test.val('select count(*)::text from public.task_internal_metrics') as mfa_metrics_aal1 \gset
select test.val('select count(*)::text from public.space_agency_settings') as mfa_agency_aal1 \gset
select set_config('request.jwt.claims', :'c_ed_aal2', true);
select test.val('select count(*)::text from public.task_internal_metrics') as mfa_metrics_aal2 \gset
rollback;
select test.check('chg_mfa_metrics_aal1_reads_nothing', :'mfa_metrics_aal1', 'ok:0');
select test.check('chg_mfa_agency_aal1_reads_nothing', :'mfa_agency_aal1', 'ok:0');
select test.check('chg_mfa_metrics_aal2_reads', :'mfa_metrics_aal2', 'ok:2');

-- 巻き戻したので、古い列も新表も seed のまま
select test.check('same_checks_left_no_change', (
  select format('tasks_with_hours=%s spaces=%s',
                (select count(*) from public.tasks where actual_hours is not null), (select count(*) from public.spaces))
), 'tasks_with_hours=2 spaces=2');

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
    raise exception 'INTERNAL METRICS AGENCY TABLES CHECKS FAILED (% failures)', v_fail;
  end if;
end $$;
select 'INTERNAL METRICS AGENCY TABLES CHECKS PASSED' as result;
