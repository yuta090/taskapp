-- =============================================================================
-- 連携の状態と AI 利用の集計のビューはサーバーだけが使う（*_view_privileges_server_only.sql）の挙動検証
-- 前提: run_view_privileges_server_only.sh が _local_bootstrap → Supabase の権限の代役 → migrations（本 migration の手前まで）→
--   view_privileges_server_only_seed.sql → 本 migration（RED=1 のときは本 migration だけ流さない）。データと人物は seed のとおり。
-- 画面と同じ読み書きは set role authenticated ＋ request.jwt.claims（RLS を通る）。未ログインは set role anon。
-- サーバーの鍵と同じ読み書きは set role service_role（RLS を通らない）。
--
-- label:
--   chg_*    本 migration で変わるもの（適用前は FAIL・適用後は PASS であるべき）
--   same_*   本 migration で変えないもの（両方で PASS）
-- 出力: PASS[label] / FAIL[label]。最後に FAIL が 0 件なら "VIEW PRIVILEGES SERVER ONLY CHECKS PASSED"。
--   1件でもあれば例外で終了する。書き込みはサブトランザクションで実行し、必ず巻き戻す（各 assert は独立）。
-- =============================================================================
set client_min_messages = notice;

\set c_sa '{"sub":"00000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal1"}'
\set c_u1 '{"sub":"00000000-0000-0000-0000-00000000c002","role":"authenticated","aal":"aal1"}'
-- 断られ方: ビュー・表の権限で断られる
\set status_denied 'err:42501:permission denied for view system_integration_status'
\set monthly_denied 'err:42501:permission denied for view app_org_ai_usage_monthly'
\set configs_denied 'err:42501:permission denied for table system_integration_configs'
\set all_privs 'DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE'

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

-- 連携の設定（provider:enabled を provider 順に。行が無ければ -）。RLS に隠されずに読む
create or replace function test.configs()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(string_agg(c.provider || ':' || c.enabled::text, ',' order by c.provider), '-')
    from public.system_integration_configs c
$$;

-- その役割がその表・ビューに持っている権限（アルファベット順。無ければ -）
create or replace function test.privs(p_role text, p_rel text)
returns text language sql stable as $$
  select coalesce(string_agg(x.priv, ',' order by x.priv collate "C"), '-')
    from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) as x(priv)
   where has_table_privilege(p_role, p_rel, x.priv)
$$;

-- ビューが security_invoker = true か
create or replace function test.invoker(p_rel text)
returns text language sql stable as $$
  select coalesce((select (c.reloptions @> array['security_invoker=true'])::text
                     from pg_class c where c.oid = p_rel::regclass), 'false')
$$;

-- 関数を作る migration が「既定の実行権を付けない」ので、補助関数は明示で grant する
grant execute on all functions in schema test to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 形: security_invoker・表とビューの権限・ポリシー・既にある行
-- -----------------------------------------------------------------------------
\echo '== shape =='
select test.check('chg_status_view_security_invoker', test.invoker('public.system_integration_status'), 'true');
select test.check('chg_monthly_view_security_invoker', test.invoker('public.app_org_ai_usage_monthly'), 'true');
select test.check('chg_status_view_no_anon_authenticated_privileges',
  'anon=' || test.privs('anon', 'public.system_integration_status')
  || ' authenticated=' || test.privs('authenticated', 'public.system_integration_status'),
  'anon=- authenticated=-');
select test.check('chg_monthly_view_no_anon_authenticated_privileges',
  'anon=' || test.privs('anon', 'public.app_org_ai_usage_monthly')
  || ' authenticated=' || test.privs('authenticated', 'public.app_org_ai_usage_monthly'),
  'anon=- authenticated=-');
select test.check('same_views_service_role_privileges',
  test.privs('service_role', 'public.system_integration_status') || ' / '
  || test.privs('service_role', 'public.app_org_ai_usage_monthly'),
  :'all_privs' || ' / ' || :'all_privs');
select test.check('chg_configs_anon_no_privileges', test.privs('anon', 'public.system_integration_configs'), '-');
select test.check('chg_configs_authenticated_privileges', test.privs('authenticated', 'public.system_integration_configs'),
  'DELETE,INSERT,SELECT,UPDATE');
select test.check('same_configs_service_role_privileges', test.privs('service_role', 'public.system_integration_configs'),
  :'all_privs');
select test.check('same_configs_policies_unchanged', (
  select string_agg(p.policyname || ':' || p.permissive || ':' || p.cmd, ', ' order by p.policyname collate "C")
    from pg_policies p where p.schemaname = 'public' and p.tablename = 'system_integration_configs'
), 'mfa_required_when_enrolled:RESTRICTIVE:ALL, superadmin can delete system configs:PERMISSIVE:DELETE, '
   'superadmin can insert system configs:PERMISSIVE:INSERT, superadmin can update system configs:PERMISSIVE:UPDATE, '
   'superadmin can view system configs:PERMISSIVE:SELECT');
select test.check('same_configs_rls_enabled', (
  select c.relrowsecurity::text from pg_class c where c.oid = 'public.system_integration_configs'::regclass
), 'true');

-- 二要素認証の RESTRICTIVE: RLS が有効な public の全表にある
select test.check('same_mfa_on_all_rls_tables', (
  select count(*)::text from pg_tables t
  where t.schemaname = 'public' and t.rowsecurity
    and not exists (select 1 from pg_policies p
                    where p.schemaname = 'public' and p.tablename = t.tablename
                      and p.policyname = 'mfa_required_when_enrolled')
), '0');

select test.check('same_rows_kept', test.configs() || '|' || (select count(*)::text from public.ai_usage_events),
  'github:true,slack:false|3');

-- -----------------------------------------------------------------------------
-- 未ログイン（anon）: ビューも元の表も、読むのも書くのも権限で断られる
-- -----------------------------------------------------------------------------
\echo '== anon =='
begin;
set local role anon;
select set_config('request.jwt.claims', '', true);
select test.check('chg_anon_cannot_read_status_view', test.flow(array[]::text[],
  $q$select string_agg(provider || ':' || enabled::text, ',' order by provider) from public.system_integration_status$q$),
  :'status_denied');
select test.check('chg_anon_cannot_update_via_status_view', test.flow(
  array[$q$update public.system_integration_status set enabled = false where provider = 'github'$q$],
  $q$select test.configs()$q$), :'status_denied');
select test.check('chg_anon_cannot_delete_via_status_view', test.flow(
  array[$q$delete from public.system_integration_status where provider = 'slack'$q$],
  $q$select test.configs()$q$), :'status_denied');
select test.check('chg_anon_cannot_insert_via_status_view', test.flow(
  array[$q$insert into public.system_integration_status(provider, enabled) values ('zoom', true)$q$],
  $q$select test.configs()$q$), :'status_denied');
select test.check('chg_anon_cannot_read_monthly_view', test.flow(array[]::text[],
  $q$select count(*)::text from public.app_org_ai_usage_monthly$q$), :'monthly_denied');
select test.check('chg_anon_cannot_read_configs', test.flow(array[]::text[],
  $q$select count(*)::text from public.system_integration_configs$q$), :'configs_denied');
select test.check('chg_anon_cannot_update_configs', test.flow(
  array[$q$update public.system_integration_configs set enabled = false where provider = 'github'$q$],
  $q$select test.configs()$q$), :'configs_denied');
commit;

-- -----------------------------------------------------------------------------
-- ログイン中で運営でない人（u1）: ビューは権限で断られる。元の表は RLS で見えず・書けない
-- -----------------------------------------------------------------------------
\echo '== logged in, not an operator =='
begin;
set local role authenticated;
select set_config('request.jwt.claims', :'c_u1', true);
select test.check('chg_member_cannot_read_status_view', test.flow(array[]::text[],
  $q$select string_agg(provider || ':' || enabled::text, ',' order by provider) from public.system_integration_status$q$),
  :'status_denied');
select test.check('chg_member_cannot_update_via_status_view', test.flow(
  array[$q$update public.system_integration_status set enabled = false where provider = 'github'$q$],
  $q$select test.configs()$q$), :'status_denied');
select test.check('chg_member_cannot_delete_via_status_view', test.flow(
  array[$q$delete from public.system_integration_status where provider = 'slack'$q$],
  $q$select test.configs()$q$), :'status_denied');
select test.check('chg_member_cannot_read_monthly_view', test.flow(array[]::text[],
  $q$select count(*)::text from public.app_org_ai_usage_monthly$q$), :'monthly_denied');
select test.check('same_member_cannot_read_configs', test.flow(array[]::text[],
  $q$select coalesce(string_agg(provider, ','), '-') from public.system_integration_configs$q$), 'ok:-');
select test.check('same_member_cannot_update_configs', test.flow(
  array[$q$update public.system_integration_configs set enabled = false where provider = 'github'$q$],
  $q$select test.configs()$q$), 'ok:github:true,slack:false');
-- truncate は RLS を通らない（表の権限で断る）
select test.check('chg_member_cannot_truncate_configs', test.flow(
  array[$q$truncate public.system_integration_configs$q$],
  $q$select test.configs()$q$), :'configs_denied');
commit;

-- -----------------------------------------------------------------------------
-- 運営（sa）: 元の表は RLS のポリシーで読み書きできる（今までどおり）。ビューは本人の権限では使わない
-- -----------------------------------------------------------------------------
\echo '== operator (superadmin) =='
begin;
set local role authenticated;
select set_config('request.jwt.claims', :'c_sa', true);
select test.check('same_superadmin_reads_configs', test.flow(array[]::text[],
  $q$select string_agg(provider || ':' || enabled::text, ',' order by provider) from public.system_integration_configs$q$),
  'ok:github:true,slack:false');
select test.check('same_superadmin_updates_configs', test.flow(
  array[$q$update public.system_integration_configs set enabled = false where provider = 'github'$q$],
  $q$select test.configs()$q$), 'ok:github:false,slack:false');
select test.check('chg_superadmin_session_cannot_read_status_view', test.flow(array[]::text[],
  $q$select string_agg(provider || ':' || enabled::text, ',' order by provider) from public.system_integration_status$q$),
  :'status_denied');
commit;

-- -----------------------------------------------------------------------------
-- service_role（サーバーの鍵）: ビューも元の表も、今までどおり読み書きできる
-- -----------------------------------------------------------------------------
\echo '== service_role =='
begin;
set local role service_role;
select set_config('request.jwt.claims', '', true);
select test.check('same_service_role_reads_status_view', test.flow(array[]::text[],
  $q$select string_agg(provider || ':' || enabled::text, ',' order by provider) from public.system_integration_status$q$),
  'ok:github:true,slack:false');
select test.check('same_service_role_reads_monthly_view', test.flow(array[]::text[],
  $q$select string_agg(right(org_id::text, 4) || ':' || call_count::text || ':' || prompt_tokens::text, ',' order by org_id) from public.app_org_ai_usage_monthly$q$),
  'ok:a001:2:30,a002:1:1');
select test.check('same_service_role_updates_via_status_view', test.flow(
  array[$q$update public.system_integration_status set enabled = false where provider = 'github'$q$],
  $q$select test.configs()$q$), 'ok:github:false,slack:false');
select test.check('same_service_role_writes_configs', test.flow(
  array[$q$insert into public.system_integration_configs(provider, enabled, credentials_encrypted) values ('zoom', true, 'enc-zoom')$q$,
        $q$delete from public.system_integration_configs where provider = 'slack'$q$],
  $q$select test.configs()$q$), 'ok:github:true,zoom:true');
commit;

-- -----------------------------------------------------------------------------
-- security_invoker: ビューを authenticated に一時的に付けて読むと、読む人の権限で元の表の RLS が効く
--   （付けた権限はトランザクションごと取り消す。値は psql の変数に控えてから確かめる）
-- -----------------------------------------------------------------------------
\echo '== security_invoker (views granted to authenticated for this check only) =='
\set si_member_status 'unset'
\set si_member_monthly 'unset'
\set si_sa_status 'unset'
begin;
grant select on table public.system_integration_status, public.app_org_ai_usage_monthly to authenticated;
set local role authenticated;
select set_config('request.jwt.claims', :'c_u1', true);
select (select count(*) from public.system_integration_status)::text as si_member_status,
       (select count(*) from public.app_org_ai_usage_monthly)::text as si_member_monthly \gset
select set_config('request.jwt.claims', :'c_sa', true);
select (select count(*) from public.system_integration_status)::text as si_sa_status \gset
rollback;
select test.check('chg_status_view_reads_with_reader_rls', :'si_member_status', '0');
select test.check('chg_monthly_view_reads_with_reader_rls', :'si_member_monthly', '0');
select test.check('same_superadmin_reads_status_view_when_granted', :'si_sa_status', '2');

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
    raise exception 'VIEW PRIVILEGES SERVER ONLY CHECKS FAILED (% failures)', v_fail;
  end if;
end $$;
select 'VIEW PRIVILEGES SERVER ONLY CHECKS PASSED' as result;
