-- =============================================================================
-- メンバー情報が見える範囲（*_member_directory_visibility.sql）の挙動検証
-- 前提: run_member_directory_visibility.sh が _local_bootstrap → Supabase の権限の代役 → migrations →
--   member_directory_visibility_seed.sql → 本 migration（RED=1 のときは本 migration だけ流さない）。データと人物は seed のとおり。
-- 画面と同じ読み書きは set role authenticated ＋ request.jwt.claims（RLS を通る）。ログインしていない人は set role anon。
-- サーバーは set role service_role。
--
-- label:
--   chg_*    本 migration で変わるもの（適用前は FAIL・適用後は PASS であるべき）
--   same_*   本 migration で変えないもの（両方で PASS）
-- 出力: PASS[label] / FAIL[label]。最後に FAIL が 0 件なら "MEMBER DIRECTORY CHECKS PASSED"。
--   1件でもあれば例外で終了する。書き込みはサブトランザクションで実行し、必ず巻き戻す（各 assert は独立）。
-- =============================================================================
set client_min_messages = notice;

\set O1 '00000000-0000-0000-0000-00000000a001'
\set O2 '00000000-0000-0000-0000-00000000a002'
\set S1 '00000000-0000-0000-0000-00000000b001'
\set S2 '00000000-0000-0000-0000-00000000b002'
\set u_cli '00000000-0000-0000-0000-00000000c004'
\set u_np '00000000-0000-0000-0000-00000000c009'
\set c_own '{"sub":"00000000-0000-0000-0000-00000000c001","role":"authenticated"}'
\set c_mem '{"sub":"00000000-0000-0000-0000-00000000c002","role":"authenticated"}'
\set c_memout '{"sub":"00000000-0000-0000-0000-00000000c003","role":"authenticated"}'
\set c_cli '{"sub":"00000000-0000-0000-0000-00000000c004","role":"authenticated"}'
\set c_cli2 '{"sub":"00000000-0000-0000-0000-00000000c005","role":"authenticated"}'
\set c_ven '{"sub":"00000000-0000-0000-0000-00000000c006","role":"authenticated"}'
\set c_o2 '{"sub":"00000000-0000-0000-0000-00000000c007","role":"authenticated"}'
\set c_nomem '{"sub":"00000000-0000-0000-0000-00000000c008","role":"authenticated"}'
\set c_np '{"sub":"00000000-0000-0000-0000-00000000c009","role":"authenticated"}'
-- 本 migration の rpc_get_org_members の本文の md5
\set md5_org_members '3b3ecfb965239e045d1ab884d42d212a'

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

-- 呼んだ人に見える profiles の名前（名前順）
\set q_profiles 'select coalesce(string_agg(display_name, '','' order by display_name), ''(none)'') from public.profiles'
-- 呼んだ人に見える招待（i1 / i3）
\set q_invites 'select coalesce(string_agg(case id when ''00000000-0000-0000-0000-00000000e001'' then ''i1'' when ''00000000-0000-0000-0000-00000000e003'' then ''i3'' else ''other'' end, '','' order by 1), ''(none)'') from public.invites'

-- -----------------------------------------------------------------------------
-- 形
-- -----------------------------------------------------------------------------
\echo '== shape =='
select test.check('chg_select_policies', (
  select string_agg(format('%s.%s:%s:%s', tablename, policyname, array_to_string(roles, ','), coalesce(qual, '-')),
                    ' | ' order by tablename, policyname)
    from pg_policies
   where schemaname = 'public' and cmd = 'SELECT' and tablename in ('profiles', 'invites', 'org_memberships')
), 'invites.invites_select_manager:authenticated:(app_is_org_owner_or_admin(org_id) OR (created_by = ( SELECT auth.uid() AS uid)) OR (app_is_org_internal(org_id) AND (app_space_role_of_caller(space_id) = ANY (ARRAY[''admin''::text, ''editor''::text]))))'
   || ' | org_memberships.org_memberships_select_internal_or_self:authenticated:((user_id = ( SELECT auth.uid() AS uid)) OR app_is_org_internal(org_id))'
   || ' | profiles.profiles_select_visible:authenticated:app_can_see_profile(id)');

select test.check('chg_can_see_profile_function', (
  select coalesce((select format('definer=%s config=%s exec=%s/%s/%s/%s', p.prosecdef::text, array_to_string(p.proconfig, ';'),
                                 has_function_privilege('public', p.oid, 'execute')::text,
                                 has_function_privilege('anon', p.oid, 'execute')::text,
                                 has_function_privilege('authenticated', p.oid, 'execute')::text,
                                 has_function_privilege('service_role', p.oid, 'execute')::text)
                     from pg_proc p where p.oid = to_regprocedure('public.app_can_see_profile(uuid)')), 'missing')
), 'definer=true config=search_path=public exec=false/false/true/true');

select test.check('chg_profiles_and_invites_privileges', (
  select format('anon=%s truncate=%s references=%s trigger=%s email=%s token=%s role=%s table=%s',
                has_table_privilege('anon', 'public.profiles', 'SELECT')::text,
                has_table_privilege('authenticated', 'public.profiles', 'TRUNCATE')::text,
                has_table_privilege('authenticated', 'public.profiles', 'REFERENCES')::text,
                has_table_privilege('authenticated', 'public.profiles', 'TRIGGER')::text,
                has_column_privilege('authenticated', 'public.invites', 'email', 'SELECT')::text,
                has_column_privilege('authenticated', 'public.invites', 'token', 'SELECT')::text,
                has_column_privilege('authenticated', 'public.invites', 'role', 'SELECT')::text,
                has_table_privilege('authenticated', 'public.invites', 'SELECT')::text)
), 'anon=false truncate=false references=false trigger=false email=false token=false role=true table=false');

select test.check('chg_rpc_get_org_members_body', (
  select md5(prosrc) from pg_proc where oid = to_regprocedure('public.rpc_get_org_members(uuid)')
), :'md5_org_members');

select test.check('same_rpc_get_org_members_rights', (
  select format('definer=%s config=%s exec=%s/%s/%s/%s', p.prosecdef::text, array_to_string(p.proconfig, ';'),
                has_function_privilege('public', p.oid, 'execute')::text,
                has_function_privilege('anon', p.oid, 'execute')::text,
                has_function_privilege('authenticated', p.oid, 'execute')::text,
                has_function_privilege('service_role', p.oid, 'execute')::text)
    from pg_proc p where p.oid = to_regprocedure('public.rpc_get_org_members(uuid)')
), 'definer=true config=search_path=public exec=false/false/true/true');

select test.check('chg_user_id_indexes', (
  select count(*)::text from pg_class
   where oid in (coalesce(to_regclass('public.org_memberships_user_id_idx'), 0),
                 coalesce(to_regclass('public.space_memberships_user_id_idx'), 0))
), '2');

select test.check('same_mfa_policies_remain', (
  select count(*)::text from pg_policies
   where schemaname = 'public' and tablename in ('profiles', 'invites', 'org_memberships')
     and policyname = 'mfa_required_when_enrolled' and permissive = 'RESTRICTIVE'
), '3');

select test.check('same_profile_write_policies', (
  select string_agg(policyname || ':' || cmd, ',' order by policyname)
    from pg_policies where schemaname = 'public' and tablename = 'profiles' and cmd in ('INSERT', 'UPDATE')
), 'Users can insert own profile:INSERT,Users can update own profile:UPDATE');

-- -----------------------------------------------------------------------------
-- profiles: 一緒に仕事をしている関係の人だけが見える
-- -----------------------------------------------------------------------------
\echo '== profiles =='
begin;
set local role authenticated;
select set_config('request.jwt.claims', :'c_own', true);
select test.check('chg_owner_sees_own_org_people', test.val(:'q_profiles'), 'ok:cli,cli2,mem,memout,own,ven');
select set_config('request.jwt.claims', :'c_mem', true);
select test.check('chg_member_sees_own_org_people', test.val(:'q_profiles'), 'ok:cli,cli2,mem,memout,own,ven');
select set_config('request.jwt.claims', :'c_memout', true);
select test.check('chg_member_without_space_sees_own_org_people', test.val(:'q_profiles'), 'ok:cli,cli2,mem,memout,own,ven');
select set_config('request.jwt.claims', :'c_cli', true);
select test.check('chg_client_sees_staff_and_same_space', test.val(:'q_profiles'), 'ok:cli,mem,memout,own,ven');
select set_config('request.jwt.claims', :'c_cli2', true);
select test.check('chg_client2_sees_staff_and_same_space', test.val(:'q_profiles'), 'ok:cli2,mem,memout,own');
select set_config('request.jwt.claims', :'c_ven', true);
select test.check('chg_vendor_sees_staff_and_same_space', test.val(:'q_profiles'), 'ok:cli,mem,memout,own,ven');
select set_config('request.jwt.claims', :'c_o2', true);
select test.check('chg_other_org_sees_only_own_org', test.val(:'q_profiles'), 'ok:o2');
select set_config('request.jwt.claims', :'c_nomem', true);
select test.check('chg_no_org_sees_only_self', test.val(:'q_profiles'), 'ok:nomem');
-- 自分の行は作れて・書き換えられる（今までどおり）
select set_config('request.jwt.claims', :'c_np', true);
select test.check('same_insert_own_profile', test.flow(
  array[format('insert into public.profiles(id, display_name) values (%L, %L)', :'u_np', 'np')],
  format('select test.display_name(%L)', :'u_np')), 'ok:np');
select set_config('request.jwt.claims', :'c_cli', true);
select test.check('same_update_own_profile', test.flow(
  array[format('update public.profiles set display_name = %L where id = %L', 'cli-renamed', :'u_cli')],
  format('select test.display_name(%L)', :'u_cli')), 'ok:cli-renamed');
commit;

begin;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select test.check('chg_anon_cannot_read_profiles', test.val(:'q_profiles'), 'like:err:42501:%');
-- 招待の確かめ（ログイン前の画面）は今までどおり
select test.check('same_anon_validates_invite', test.val('select (public.rpc_validate_invite(''md-i1'') is not null)::text'), 'ok:true');
commit;

-- -----------------------------------------------------------------------------
-- rpc_get_org_members: 社内だけが呼べる。メールアドレスは owner / admin にだけ
-- -----------------------------------------------------------------------------
\echo '== rpc_get_org_members =='
begin;
set local role authenticated;
select set_config('request.jwt.claims', :'c_own', true);
select test.check('same_owner_gets_emails', test.val(format(
  'select count(*)::text || %L || count(email)::text from public.rpc_get_org_members(%L)', '/', :'O1')), 'ok:6/6');
select set_config('request.jwt.claims', :'c_mem', true);
select test.check('chg_member_gets_no_emails', test.val(format(
  'select count(*)::text || %L || count(email)::text from public.rpc_get_org_members(%L)', '/', :'O1')), 'ok:6/0');
select set_config('request.jwt.claims', :'c_cli', true);
select test.check('chg_client_cannot_list_org_members', test.val(format(
  'select count(*)::text from public.rpc_get_org_members(%L)', :'O1')), 'like:err:P0001:Access denied%');
select set_config('request.jwt.claims', :'c_o2', true);
select test.check('same_other_org_cannot_list_org_members', test.val(format(
  'select count(*)::text from public.rpc_get_org_members(%L)', :'O1')), 'like:err:P0001:Access denied%');
commit;

-- -----------------------------------------------------------------------------
-- invites: email・token の列はログイン中の人に読ませない。行は管理する人だけ
-- -----------------------------------------------------------------------------
\echo '== invites =='
begin;
set local role authenticated;
select set_config('request.jwt.claims', :'c_own', true);
select test.check('chg_authenticated_cannot_read_invite_token', test.val('select token from public.invites limit 1'), 'like:err:42501:%');
select test.check('chg_authenticated_cannot_read_invite_email', test.val('select email from public.invites limit 1'), 'like:err:42501:%');
select test.check('same_authenticated_reads_invite_role', test.val('select count(role)::text from public.invites'), 'ok:2');
select test.check('same_owner_sees_all_invites', test.val(:'q_invites'), 'ok:i1,i3');
select set_config('request.jwt.claims', :'c_mem', true);
select test.check('chg_editor_sees_own_space_invites', test.val(:'q_invites'), 'ok:i1');
select set_config('request.jwt.claims', :'c_memout', true);
select test.check('chg_member_sees_only_invites_they_made', test.val(:'q_invites'), 'ok:i3');
select set_config('request.jwt.claims', :'c_cli', true);
select test.check('same_client_sees_no_invites', test.val(:'q_invites'), 'ok:(none)');
commit;

begin;
set local role service_role;
select test.check('same_service_reads_all_invite_columns', test.val(
  'select count(token)::text || ''/'' || count(email)::text from public.invites'), 'ok:2/2');
commit;

-- -----------------------------------------------------------------------------
-- org_memberships: 自分の行と、その組織の社内メンバーだけ
-- -----------------------------------------------------------------------------
\echo '== org_memberships =='
begin;
set local role authenticated;
select set_config('request.jwt.claims', :'c_cli', true);
select test.check('chg_client_sees_only_own_org_membership', test.val(format(
  'select count(*)::text from public.org_memberships where org_id = %L', :'O1')), 'ok:1');
select set_config('request.jwt.claims', :'c_mem', true);
select test.check('same_member_sees_all_org_memberships', test.val(format(
  'select count(*)::text from public.org_memberships where org_id = %L', :'O1')), 'ok:6');
select set_config('request.jwt.claims', :'c_o2', true);
select test.check('same_other_org_sees_no_org_memberships', test.val(format(
  'select count(*)::text from public.org_memberships where org_id = %L', :'O1')), 'ok:0');

-- rpc_get_space_members は今までどおり（名前は SECURITY DEFINER で読むので、profiles の決まりに左右されない）
select set_config('request.jwt.claims', :'c_cli', true);
select test.check('same_space_members_rpc_s1', test.val(format(
  'select string_agg(display_name || %L || role, %L order by display_name) from public.rpc_get_space_members(%L)', ':', ',', :'S1')),
  'ok:cli:client,mem:editor,own:admin,ven:vendor');
select set_config('request.jwt.claims', :'c_cli2', true);
select test.check('same_space_members_rpc_s2', test.val(format(
  'select string_agg(display_name || %L || role, %L order by display_name) from public.rpc_get_space_members(%L)', ':', ',', :'S2')),
  'ok:cli2:client,own:admin');
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
    raise exception 'MEMBER DIRECTORY CHECKS FAILED (% failures)', v_fail;
  end if;
end $$;
select 'MEMBER DIRECTORY CHECKS PASSED' as result;
