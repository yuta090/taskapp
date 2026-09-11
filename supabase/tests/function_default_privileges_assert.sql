-- =============================================================================
-- 関数の既定の実行権（*_function_default_privileges.sql = A）と rpc_check_org_limits の実行権
-- （*_rpc_check_org_limits_service_role_only.sql = A2）の挙動検証
-- 前提: run_function_default_privileges.sh が _local_bootstrap → Supabase の権限の代役（本番と同じ関数の既定の実行権）→
--   migrations を verbatim 適用済み（RED=1 のときは A・A2 を適用しない）。
--   既にある関数の実行権が A で1本も変わらないことは、ハーネスが適用前後のスキーマの指紋で確かめる（scope_*）。
--
-- データ: 組織 O1（owner 1 人＋member 3 人 = 社内 4 人・space S1・招待 I1）、
--         組織 O2（owner 1 人＋member 4 人 = 社内 5 人 = free の上限・space S2・招待 I2）。
--   どちらも org_billing が無い = free（members_limit 5）。
-- 人物（set role ＋ request.jwt.claims の sub で切り替える）: own = O1 owner / o2 = O2 owner / nu1・nu2 = 招待を受ける人
--
-- label:
--   chg_*   A・A2 で結果が変わるもの（適用前は FAIL・適用後は PASS であるべき）
--   same_*  適用前後で結果が同じであるべきもの（両方で PASS）
-- 出力: PASS[label] / FAIL[label]。最後に FAIL が 0 件なら "FUNCTION DEFAULT PRIVILEGES CHECKS PASSED"。
--   1件でもあれば例外で終了する。調べるために作った関数とスキーマは最後に消す。
-- =============================================================================
set client_min_messages = notice;

\set O1 '00000000-0000-0000-0000-00000000a001'
\set O2 '00000000-0000-0000-0000-00000000a002'
\set S1 '00000000-0000-0000-0000-00000000b001'
\set S2 '00000000-0000-0000-0000-00000000b002'
\set u_own '00000000-0000-0000-0000-00000000c001'
\set u_m1  '00000000-0000-0000-0000-00000000c002'
\set u_m2  '00000000-0000-0000-0000-00000000c003'
\set u_m3  '00000000-0000-0000-0000-00000000c004'
\set u_o2  '00000000-0000-0000-0000-00000000c005'
\set u_n1  '00000000-0000-0000-0000-00000000c006'
\set u_n2  '00000000-0000-0000-0000-00000000c007'
\set u_n3  '00000000-0000-0000-0000-00000000c008'
\set u_n4  '00000000-0000-0000-0000-00000000c009'
\set u_nu1 '00000000-0000-0000-0000-00000000c010'
\set u_nu2 '00000000-0000-0000-0000-00000000c011'

\set c_own '{"sub":"00000000-0000-0000-0000-00000000c001","role":"authenticated"}'
\set c_o2  '{"sub":"00000000-0000-0000-0000-00000000c005","role":"authenticated"}'

-- -----------------------------------------------------------------------------
-- 検証ヘルパ
-- -----------------------------------------------------------------------------
create schema if not exists test;
grant usage on schema test to anon, authenticated, service_role;
create table test.results (seq serial primary key, label text, ok boolean, got text, want text);

-- 結果の記録（definer: anon / authenticated / service_role の視点のままでも記録できる）
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

-- 呼んだ人の権限で、値を1つ返す SQL を流し、値を返して必ず巻き戻す
--   ok:<値> / err:<SQLSTATE>:<メッセージ>
create or replace function test.val(p_sql text)
returns text language plpgsql security invoker as $$
declare
  v text;
  v_state text;
  v_detail text;
  v_msg text;
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

-- 関数の実行権（並べ替えたもの）
create or replace function test.acl(p_fn text)
returns text language sql stable as $$
  select coalesce(string_agg(a::text, ',' order by a::text), '(null)')
    from pg_proc p, unnest(p.proacl) as a
   where p.oid = p_fn::regprocedure;
$$;

-- A のあとは postgres が作る関数に既定の実行権が付かない（public 以外のスキーマでも）ので、補助関数は明示で grant する
grant execute on all functions in schema test to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- A: postgres が新しく作る関数の実行権
--   public に作る関数: anon / authenticated / PUBLIC は実行できない（chg_）。service_role と持ち主は実行できる（same_）
--   public 以外のスキーマに作る関数: 全体の既定から PUBLIC が外れるので、誰も実行できない（chg_）
-- -----------------------------------------------------------------------------
create function public.dfp_probe() returns int language sql as 'select 1';
create function public.dfp_probe_definer() returns int language sql security definer set search_path = public as 'select 1';
create schema dfp_other;
grant usage on schema dfp_other to anon, authenticated, service_role;
create function dfp_other.dfp_probe() returns int language sql as 'select 1';

select test.check('chg_a_new_function_acl', test.acl('public.dfp_probe()'), 'postgres=X/postgres,service_role=X/postgres');
select test.check('chg_a_new_definer_function_acl', test.acl('public.dfp_probe_definer()'), 'postgres=X/postgres,service_role=X/postgres');
select test.check('chg_a_other_schema_function_acl', test.acl('dfp_other.dfp_probe()'), 'postgres=X/postgres');

-- 実行権の表: 列は「chg|same:実行できるか(true|false)」。label は <chg|same>_a_<tag>_<who>_<can|cannot>_execute
select test.check(
         split_part(x.spec, ':', 1) || '_a_' || e.tag || '_' || x.who || '_'
           || case when split_part(x.spec, ':', 2) = 'true' then 'can' else 'cannot' end || '_execute',
         has_function_privilege(x.who, e.fn, 'execute')::text,
         split_part(x.spec, ':', 2))
  from (values
    (1, 'new_function',         'public.dfp_probe()',         'chg:false', 'chg:false', 'chg:false', 'same:true', 'same:true'),
    (2, 'new_definer_function', 'public.dfp_probe_definer()', 'chg:false', 'chg:false', 'chg:false', 'same:true', 'same:true'),
    (3, 'other_schema_function', 'dfp_other.dfp_probe()',     'chg:false', 'chg:false', 'chg:false', 'chg:false', 'same:true')
  ) as e(n, tag, fn, p_public, p_anon, p_authenticated, p_service_role, p_owner)
  cross join lateral (values
    (1, 'public', e.p_public), (2, 'anon', e.p_anon), (3, 'authenticated', e.p_authenticated),
    (4, 'service_role', e.p_service_role), (5, 'postgres', e.p_owner)
  ) as x(k, who, spec)
 order by e.n, x.k;

-- 実際に呼ぶ: anon / authenticated は 42501 で断られ、service_role は呼べる
set role anon;
select set_config('request.jwt.claims', '', false);
select test.check('chg_a_new_function_anon_call_denied', test.val('select public.dfp_probe()::text'), 'like:err:42501:%');
reset role;
set role authenticated;
select set_config('request.jwt.claims', :'c_own', false);
select test.check('chg_a_new_function_authenticated_call_denied', test.val('select public.dfp_probe()::text'), 'like:err:42501:%');
reset role;
set role service_role;
select set_config('request.jwt.claims', '', false);
select test.check('same_a_new_function_service_role_call_works', test.val('select public.dfp_probe()::text'), 'ok:1');
reset role;

-- 既にある関数を create or replace で作り直しても、実行権は変わらない（anon が呼べる関数で確かめる）
select test.acl('public.rpc_validate_invite(text)') as acl_before \gset
do $$ begin execute pg_get_functiondef('public.rpc_validate_invite(text)'::regprocedure); end $$;
select test.check('same_a_create_or_replace_keeps_acl',
  case when test.acl('public.rpc_validate_invite(text)') = :'acl_before' then 'kept' else test.acl('public.rpc_validate_invite(text)') end,
  'kept');
select test.check('same_a_create_or_replace_anon_still_can_execute',
  has_function_privilege('anon', 'public.rpc_validate_invite(text)', 'execute')::text, 'true');

drop function public.dfp_probe();
drop function public.dfp_probe_definer();
drop schema dfp_other cascade;

-- -----------------------------------------------------------------------------
-- データ（postgres で投入。RLS は通らない）
-- -----------------------------------------------------------------------------
insert into public.organizations(id, name) values (:'O1', 'o1'), (:'O2', 'o2');
insert into auth.users(id, email) values
  (:'u_own', 'own@example.com'), (:'u_m1', 'm1@example.com'), (:'u_m2', 'm2@example.com'), (:'u_m3', 'm3@example.com'),
  (:'u_o2', 'o2@example.com'), (:'u_n1', 'n1@example.com'), (:'u_n2', 'n2@example.com'), (:'u_n3', 'n3@example.com'),
  (:'u_n4', 'n4@example.com'), (:'u_nu1', 'nu1@example.com'), (:'u_nu2', 'nu2@example.com');
insert into public.org_memberships(org_id, user_id, role) values
  (:'O1', :'u_own', 'owner'), (:'O1', :'u_m1', 'member'), (:'O1', :'u_m2', 'member'), (:'O1', :'u_m3', 'member'),
  (:'O2', :'u_o2', 'owner'), (:'O2', :'u_n1', 'member'), (:'O2', :'u_n2', 'member'), (:'O2', :'u_n3', 'member'),
  (:'O2', :'u_n4', 'member');
insert into public.spaces(id, org_id, type, name) values (:'S1', :'O1', 'project', 's1'), (:'S2', :'O2', 'project', 's2');
insert into public.invites(org_id, space_id, email, role, token, expires_at, created_by) values
  (:'O1', :'S1', 'nu1@example.com', 'member', 'dfp-o1-member', now() + interval '1 day', :'u_own'),
  (:'O2', :'S2', 'nu2@example.com', 'member', 'dfp-o2-member', now() + interval '1 day', :'u_o2');

-- -----------------------------------------------------------------------------
-- A2: rpc_check_org_limits は service_role だけが呼べる
-- -----------------------------------------------------------------------------
select test.check(
         split_part(x.spec, ':', 1) || '_a2_' || x.who || '_'
           || case when split_part(x.spec, ':', 2) = 'true' then 'can' else 'cannot' end || '_execute',
         has_function_privilege(x.who, 'public.rpc_check_org_limits(uuid)', 'execute')::text,
         split_part(x.spec, ':', 2))
  from (values
    (1, 'public', 'chg:false'), (2, 'anon', 'chg:false'), (3, 'authenticated', 'chg:false'), (4, 'service_role', 'same:true')
  ) as x(k, who, spec)
 order by x.k;

set role anon;
select set_config('request.jwt.claims', '', false);
select test.check('chg_a2_anon_call_denied',
  test.val(format('select public.rpc_check_org_limits(%L)::text', :'O1')), 'like:err:42501:%');
reset role;
set role authenticated;
select set_config('request.jwt.claims', :'c_own', false);
select test.check('chg_a2_authenticated_call_denied',
  test.val(format('select public.rpc_check_org_limits(%L)::text', :'O1')), 'like:err:42501:%');
reset role;
set role service_role;
select set_config('request.jwt.claims', '', false);
select test.check('same_a2_service_role_call_works',
  test.val(format('select format(%L, r ->> %L, r -> %L ->> %L, r -> %L ->> %L) from public.rpc_check_org_limits(%L) as r',
                  'plan=%s members=%s can_add=%s', 'plan_id', 'members', 'current', 'members', 'can_add', :'O1')),
  'ok:plan=free members=4 can_add=true');
reset role;

-- -----------------------------------------------------------------------------
-- A2: 招待の作成と受諾（DB の中の SECURITY DEFINER 関数から呼ぶ）は、今までどおり人数の上限で止まる・通る
--   O1 は社内 4 人（まだ入れる）、O2 は社内 5 人（free の上限）
-- -----------------------------------------------------------------------------
set role authenticated;
select set_config('request.jwt.claims', :'c_own', false);
select test.check('same_a2_create_invite_under_limit',
  test.val(format('select ((public.rpc_create_invite(%L, %L, %L, %L, %L)) ->> %L is not null)::text',
                  :'O1', :'S1', 'new-member@example.com', 'member', :'u_own', 'token')),
  'ok:true');
select set_config('request.jwt.claims', :'c_o2', false);
select test.check('same_a2_create_invite_at_limit',
  test.val(format('select ((public.rpc_create_invite(%L, %L, %L, %L, %L)) ->> %L is not null)::text',
                  :'O2', :'S2', 'new-member@example.com', 'member', :'u_o2', 'token')),
  'like:err:P0001:Organization has reached member limit%');
reset role;

set role service_role;
select set_config('request.jwt.claims', '', false);
select test.check('same_a2_accept_invite_under_limit',
  test.val(format('select (public.rpc_accept_invite(%L, %L)) ->> %L', 'dfp-o1-member', :'u_nu1', 'role')),
  'ok:member');
select test.check('same_a2_accept_invite_at_limit',
  test.val(format('select (public.rpc_accept_invite(%L, %L)) ->> %L', 'dfp-o2-member', :'u_nu2', 'role')),
  'like:err:P0001:Organization has reached member limit%');
reset role;

-- 巻き戻したので、招待は増えず、受諾もされていない
select test.check('same_a2_invite_checks_left_no_change', (
  select format('invites=%s accepted=%s', count(*), count(*) filter (where accepted_at is not null)) from public.invites
), 'invites=2 accepted=0');

-- -----------------------------------------------------------------------------
-- 二要素認証の RESTRICTIVE: RLS が有効な public の全表にある
-- -----------------------------------------------------------------------------
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
    raise exception 'FUNCTION DEFAULT PRIVILEGES CHECKS FAILED (% failures)', v_fail;
  end if;
end $$;
select 'FUNCTION DEFAULT PRIVILEGES CHECKS PASSED' as result;
