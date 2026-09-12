-- =============================================================================
-- メンバー情報が見える範囲の続き（*_member_directory_superadmin_space_members.sql）の挙動検証
-- 前提: run_member_directory_superadmin_space_members.sh が _local_bootstrap → Supabase の権限の代役 → migrations →
--   member_directory_superadmin_space_members_seed.sql → 本 migration（RED=1 のときは本 migration だけ流さない）。
--   データと人物は seed のとおり。
-- 画面と同じ読み書きは set role authenticated ＋ request.jwt.claims（RLS を通る）。ログインしていない人は set role anon。
-- サーバーは set role service_role。
--
-- label:
--   chg_*    本 migration で変わるもの（適用前は FAIL・適用後は PASS であるべき）
--   same_*   本 migration で変えないもの（両方で PASS）
-- 出力: PASS[label] / FAIL[label]。最後に FAIL が 0 件なら "SUPERADMIN SPACE MEMBERS CHECKS PASSED"。
--   1件でもあれば例外で終了する。書き込みはサブトランザクションで実行し、必ず巻き戻す（各 assert は独立）。
-- =============================================================================
set client_min_messages = notice;

\set S1 '00000000-0000-0000-0000-00000000b001'
\set u_own '00000000-0000-0000-0000-00000000c001'
\set u_sa '00000000-0000-0000-0000-00000000c008'
\set c_own '{"sub":"00000000-0000-0000-0000-00000000c001","role":"authenticated"}'
\set c_mem '{"sub":"00000000-0000-0000-0000-00000000c002","role":"authenticated"}'
\set c_vw '{"sub":"00000000-0000-0000-0000-00000000c003","role":"authenticated"}'
\set c_cli '{"sub":"00000000-0000-0000-0000-00000000c004","role":"authenticated"}'
\set c_ven '{"sub":"00000000-0000-0000-0000-00000000c006","role":"authenticated"}'
\set c_sa '{"sub":"00000000-0000-0000-0000-00000000c008","role":"authenticated"}'
\set c_out '{"sub":"00000000-0000-0000-0000-00000000c009","role":"authenticated"}'
-- 本 migration の rpc_get_space_members の本文の md5
\set md5_space_members 'b74cd05e6ed91cde1fdca436dc534d6a'

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

create or replace function test.val(p_sql text)
returns text language sql security invoker as $$ select test.flow(array[]::text[], p_sql) $$;

-- 行を RLS に隠されずに読む
create or replace function test.display_name(p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select display_name from public.profiles where id = p_user), '(no row)')
$$;

-- 関数を作る migration が「既定の実行権を付けない」ので、補助関数は明示で grant する
grant execute on all functions in schema test to anon, authenticated, service_role;

-- 呼んだ人に返る S1 のメンバー（名前:役割・名前順）
\set q_space_members 'select string_agg(display_name || '':'' || role, '','' order by display_name) from public.rpc_get_space_members(''00000000-0000-0000-0000-00000000b001'')'

-- -----------------------------------------------------------------------------
-- 形
-- -----------------------------------------------------------------------------
\echo '== shape =='
select test.check('chg_profiles_column_privileges', (
  select format('is_superadmin=%s display_name=%s onboarding_flags=%s table_select=%s update=%s',
                has_column_privilege('authenticated', 'public.profiles', 'is_superadmin', 'SELECT')::text,
                has_column_privilege('authenticated', 'public.profiles', 'display_name', 'SELECT')::text,
                has_column_privilege('authenticated', 'public.profiles', 'onboarding_flags', 'SELECT')::text,
                has_table_privilege('authenticated', 'public.profiles', 'SELECT')::text,
                has_table_privilege('authenticated', 'public.profiles', 'UPDATE')::text)
), 'is_superadmin=false display_name=true onboarding_flags=true table_select=false update=true');

-- 判定は (select …) で包んだ形（行ごとでなく1文に1回だけ呼ぶ）
select test.check('chg_system_configs_policies', (
  select string_agg(format('%s:%s:%s', policyname, array_to_string(roles, ','),
                           (regexp_replace(coalesce(qual, with_check), '\s+', ' ', 'g')
                            = '( SELECT rpc_is_superadmin() AS rpc_is_superadmin)')::text), ' | ' order by policyname)
    from pg_policies
   where schemaname = 'public' and tablename = 'system_integration_configs' and policyname like 'superadmin can %'
), 'superadmin can delete system configs:authenticated:true'
   || ' | superadmin can insert system configs:authenticated:true'
   || ' | superadmin can update system configs:authenticated:true'
   || ' | superadmin can view system configs:authenticated:true');

select test.check('chg_space_members_body', (
  select md5(prosrc) from pg_proc where oid = to_regprocedure('public.rpc_get_space_members(uuid)')
), :'md5_space_members');

select test.check('same_space_members_rights', (
  select format('definer=%s config=%s exec=%s/%s/%s/%s', p.prosecdef::text, array_to_string(p.proconfig, ';'),
                has_function_privilege('public', p.oid, 'execute')::text,
                has_function_privilege('anon', p.oid, 'execute')::text,
                has_function_privilege('authenticated', p.oid, 'execute')::text,
                has_function_privilege('service_role', p.oid, 'execute')::text)
    from pg_proc p where p.oid = to_regprocedure('public.rpc_get_space_members(uuid)')
), 'definer=true config=search_path=public exec=false/false/true/true');

-- メンバー情報の応急（profiles の読み取りの決まり）はそのまま
select test.check('same_profiles_select_policy', (
  select string_agg(policyname, ',' order by policyname) from pg_policies
   where schemaname = 'public' and tablename = 'profiles' and cmd = 'SELECT'
), 'profiles_select_visible');

-- -----------------------------------------------------------------------------
-- 運営のフラグ: ログイン中の人は読めない。運営かどうかは rpc_is_superadmin() で今までどおり
-- -----------------------------------------------------------------------------
\echo '== is_superadmin =='
begin;
set local role authenticated;
select set_config('request.jwt.claims', :'c_own', true);
select test.check('chg_authenticated_cannot_read_is_superadmin', test.val(format(
  'select is_superadmin::text from public.profiles where id = %L', :'u_own')), 'like:err:42501:%');
-- 列を全部読む書き方（select *）も通らない（読むときは列を書く）
select test.check('chg_profiles_select_star_is_denied', test.val(format(
  'select count(*)::text from (select * from public.profiles where id = %L) x', :'u_own')), 'like:err:42501:%');
select test.check('same_authenticated_reads_names', test.val(format(
  'select display_name from public.profiles where id = %L', :'u_own')), 'ok:own');
select test.check('same_authenticated_reads_own_flags', test.val(format(
  'select (onboarding_flags is not null)::text from public.profiles where id = %L', :'u_own')), 'ok:true');
select test.check('same_update_own_profile', test.flow(
  array[format('update public.profiles set display_name = %L where id = %L', 'own-renamed', :'u_own')],
  format('select test.display_name(%L)', :'u_own')), 'ok:own-renamed');
-- 書いた行を返させるときは列を書く（全列を返させる書き方は通らない）
select test.check('chg_update_returning_all_columns_is_denied', test.flow(
  array[format('update public.profiles set display_name = display_name where id = %L returning *', :'u_own')],
  format('select test.display_name(%L)', :'u_own')), 'like:err:42501:%');
select test.check('same_upsert_returning_listed_columns', test.flow(
  array[format('insert into public.profiles(id, display_name) values (%L, %L) on conflict (id) do update '
               'set display_name = excluded.display_name returning id, display_name', :'u_own', 'own-upserted')],
  format('select test.display_name(%L)', :'u_own')), 'ok:own-upserted');
select test.check('same_not_superadmin_via_rpc', test.val('select public.rpc_is_superadmin()::text'), 'ok:false');
select test.check('same_member_sees_no_system_configs', test.val(
  'select count(*)::text from public.system_integration_configs'), 'ok:0');
select set_config('request.jwt.claims', :'c_sa', true);
select test.check('same_superadmin_via_rpc', test.val('select public.rpc_is_superadmin()::text'), 'ok:true');
select test.check('same_superadmin_reads_system_configs', test.val(
  'select count(*)::text from public.system_integration_configs'), 'ok:1');
commit;

begin;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
-- ログインしていない人: 行は見えず、エラーにもならない
select test.check('chg_anon_gets_no_system_configs_without_error', test.val(
  'select count(*)::text from public.system_integration_configs'), 'ok:0');
commit;

begin;
set local role service_role;
select test.check('same_service_reads_is_superadmin', test.val(format(
  'select is_superadmin::text from public.profiles where id = %L', :'u_sa')), 'ok:true');
commit;

-- -----------------------------------------------------------------------------
-- rpc_get_space_members: 社内には全員。相手先には社内と相手先、協力会社には社内と協力会社
-- -----------------------------------------------------------------------------
\echo '== rpc_get_space_members =='
begin;
set local role authenticated;
select set_config('request.jwt.claims', :'c_own', true);
select test.check('same_admin_sees_all_space_members', test.val(:'q_space_members'),
  'ok:cli:client,cli3:client,mem:editor,own:admin,ven:vendor,ven2:vendor,vw:viewer');
select set_config('request.jwt.claims', :'c_mem', true);
select test.check('same_editor_sees_all_space_members', test.val(:'q_space_members'),
  'ok:cli:client,cli3:client,mem:editor,own:admin,ven:vendor,ven2:vendor,vw:viewer');
select set_config('request.jwt.claims', :'c_vw', true);
select test.check('same_viewer_sees_all_space_members', test.val(:'q_space_members'),
  'ok:cli:client,cli3:client,mem:editor,own:admin,ven:vendor,ven2:vendor,vw:viewer');
select set_config('request.jwt.claims', :'c_cli', true);
select test.check('chg_client_sees_internal_and_clients', test.val(:'q_space_members'),
  'ok:cli:client,cli3:client,mem:editor,own:admin,vw:viewer');
select set_config('request.jwt.claims', :'c_ven', true);
select test.check('chg_vendor_sees_internal_and_vendors', test.val(:'q_space_members'),
  'ok:mem:editor,own:admin,ven:vendor,ven2:vendor,vw:viewer');
select set_config('request.jwt.claims', :'c_out', true);
select test.check('same_outsider_cannot_list_space_members', test.val(:'q_space_members'), 'like:err:P0001:Access denied%');
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
    raise exception 'SUPERADMIN SPACE MEMBERS CHECKS FAILED (% failures)', v_fail;
  end if;
end $$;
select 'SUPERADMIN SPACE MEMBERS CHECKS PASSED' as result;
