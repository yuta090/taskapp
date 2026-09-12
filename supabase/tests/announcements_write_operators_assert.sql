-- =============================================================================
-- お知らせを作る・変える・消すのは運営だけ（*_announcements_write_operators.sql）の挙動検証
-- 前提: run_announcements_write_operators.sh が _local_bootstrap → Supabase の権限の代役 → migrations（本 migration の手前まで）→
--   announcements_write_operators_seed.sql →（prod の複製だけ announcements_write_operators_prod_shape.sql）→ 本 migration
--   （RED=1 のときは本 migration だけ流さない）。データと人物は seed のとおり。
-- 運営画面・ベルと同じ読み書きは set role authenticated ＋ request.jwt.claims（RLS を通る）。
-- 運営画面のサーバーと同じ読み書きは set role service_role（RLS を通らない）。未ログインは set role anon。
--
-- label（本番の形から見て）:
--   chg_*    本 migration で変わるもの（適用前は FAIL・適用後は PASS であるべき）
--   same_*   本 migration で変えないもの（両方で PASS）
-- 出力: PASS[label] / FAIL[label]。最後に FAIL が 0 件なら "ANNOUNCEMENTS WRITE OPERATORS CHECKS PASSED"。
--   1件でもあれば例外で終了する。書き込みはサブトランザクションで実行し、必ず巻き戻す（各 assert は独立）。
-- =============================================================================
set client_min_messages = notice;

\set O1 '00000000-0000-0000-0000-00000000a001'
\set O2 '00000000-0000-0000-0000-00000000a002'
\set A_gpub '00000000-0000-0000-0000-00000000e001'
\set A_gdraft '00000000-0000-0000-0000-00000000e002'
\set A_o1pub '00000000-0000-0000-0000-00000000e003'
\set A_o2pub '00000000-0000-0000-0000-00000000e005'
\set c_sa '{"sub":"00000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal1"}'
\set c_sa2_aal1 '{"sub":"00000000-0000-0000-0000-00000000c002","role":"authenticated","aal":"aal1"}'
\set c_sa2_aal2 '{"sub":"00000000-0000-0000-0000-00000000c002","role":"authenticated","aal":"aal2"}'
\set c_own '{"sub":"00000000-0000-0000-0000-00000000c003","role":"authenticated","aal":"aal1"}'
\set c_mem '{"sub":"00000000-0000-0000-0000-00000000c004","role":"authenticated","aal":"aal1"}'
\set c_cl '{"sub":"00000000-0000-0000-0000-00000000c005","role":"authenticated","aal":"aal1"}'
\set c_out '{"sub":"00000000-0000-0000-0000-00000000c006","role":"authenticated","aal":"aal1"}'
-- 条件の md5（空白をつめて public. を外した文字列）。読む側と二要素認証は本番で 2026-09-12 に読んだ値
\set md5_write '98e7d5aeb92dc955b9351ec6565cac86'
\set md5_read 'a0fb9a028ef29665efb3c82da2e18887'
\set md5_mfa '1905ce5a61172515ba290b3913d8d251'
\set md5_empty 'd41d8cd98f00b204e9800998ecf8427e'
-- 断られ方: RLS の条件で断られる／表の権限で断られる
\set rls_denied 'like:err:42501:new row violates row-level security policy%'
\set table_denied 'err:42501:permission denied for table announcements'

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

-- お知らせ1行のタイトル（行が無ければ -）。RLS に隠されずに読む
create or replace function test.title(p_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select a.title from public.announcements a where a.id = p_id), '-')
$$;

-- そのタイトルの行の数。RLS に隠されずに読む
create or replace function test.n_title(p_title text)
returns text language sql stable security definer set search_path = public as $$
  select count(*)::text from public.announcements a where a.title = p_title
$$;

-- 呼んだ人に見えるお知らせのタイトル（RLS を通る。p_published_only で公開中だけに絞る。ベルは公開中だけを読む）
create or replace function test.visible(p_published_only boolean)
returns text language sql stable security invoker as $$
  select coalesce(string_agg(a.title, ',' order by a.title collate "C"), '-')
    from public.announcements a
   where a.published or not p_published_only
$$;

-- 条件の md5（空白をつめて public. を外した文字列）
create or replace function test.norm_md5(p_expr text)
returns text language sql immutable as $$
  select md5(regexp_replace(replace(coalesce(p_expr, ''), 'public.', ''), '\s+', ' ', 'g'))
$$;

-- その役割が announcements に持っている表の権限（アルファベット順。無ければ -）
create or replace function test.privs(p_role text)
returns text language sql stable as $$
  select coalesce(string_agg(x.priv, ',' order by x.priv collate "C"), '-')
    from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) as x(priv)
   where has_table_privilege(p_role, 'public.announcements', x.priv)
$$;

-- 関数を作る migration が「既定の実行権を付けない」ので、補助関数は明示で grant する
grant execute on all functions in schema test to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 形: ポリシー・表の権限・判定関数・既にある行
-- -----------------------------------------------------------------------------
\echo '== shape =='
select test.check('chg_write_policy_superadmin_only', (
  select coalesce(string_agg(format('%s|%s|%s|%s|%s', p.policyname, p.roles::text, p.cmd,
                                    test.norm_md5(p.qual), test.norm_md5(p.with_check)),
                             ', ' order by p.policyname collate "C"), '(none)')
    from pg_policies p
   where p.schemaname = 'public' and p.tablename = 'announcements'
     and p.permissive = 'PERMISSIVE' and p.policyname <> 'Users can read announcements'
), format('Superadmins can manage announcements|{authenticated}|ALL|%s|%s', :'md5_write', :'md5_write'));

select test.check('same_read_policy_unchanged', (
  select coalesce(string_agg(format('%s|%s|%s|%s|%s', p.permissive, p.roles::text, p.cmd,
                                    test.norm_md5(p.qual), test.norm_md5(p.with_check)), ', '), '(none)')
    from pg_policies p
   where p.schemaname = 'public' and p.tablename = 'announcements' and p.policyname = 'Users can read announcements'
), format('PERMISSIVE|{public}|SELECT|%s|%s', :'md5_read', :'md5_empty'));

select test.check('same_mfa_policy_kept', (
  select coalesce(string_agg(format('%s|%s|%s|%s|%s', p.permissive, p.roles::text, p.cmd,
                                    test.norm_md5(p.qual), test.norm_md5(p.with_check)), ', '), '(none)')
    from pg_policies p
   where p.schemaname = 'public' and p.tablename = 'announcements' and p.policyname = 'mfa_required_when_enrolled'
), format('RESTRICTIVE|{authenticated}|ALL|%s|%s', :'md5_mfa', :'md5_mfa'));

-- 二要素認証の RESTRICTIVE: RLS が有効な public の全表にある
select test.check('same_mfa_on_all_rls_tables', (
  select count(*)::text from pg_tables t
  where t.schemaname = 'public' and t.rowsecurity
    and not exists (select 1 from pg_policies p
                    where p.schemaname = 'public' and p.tablename = t.tablename
                      and p.policyname = 'mfa_required_when_enrolled')
), '0');

select test.check('same_rls_enabled', (
  select c.relrowsecurity::text from pg_class c where c.oid = 'public.announcements'::regclass
), 'true');

select test.check('chg_anon_has_no_table_privileges', test.privs('anon'), '-');
select test.check('chg_anon_has_no_acl_entry', (
  select count(*)::text from pg_class c, aclexplode(c.relacl) a
   where c.oid = 'public.announcements'::regclass and a.grantee = 'anon'::regrole
), '0');
select test.check('chg_authenticated_table_privileges', test.privs('authenticated'), 'DELETE,INSERT,SELECT,UPDATE');
select test.check('same_service_role_table_privileges', test.privs('service_role'),
  'DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE');

select test.check('same_rpc_is_superadmin_rights', (
  select format('definer=%s anon=%s authenticated=%s service_role=%s', p.prosecdef::text,
                has_function_privilege('anon', p.oid, 'execute')::text,
                has_function_privilege('authenticated', p.oid, 'execute')::text,
                has_function_privilege('service_role', p.oid, 'execute')::text)
    from pg_proc p where p.oid = 'public.rpc_is_superadmin()'::regprocedure
), 'definer=true anon=false authenticated=true service_role=true');

select test.check('same_rows_kept', (
  select string_agg(a.title, ',' order by a.title collate "C") from public.announcements a
), 'g_draft,g_pub,o1_draft,o1_pub,o2_pub');

-- -----------------------------------------------------------------------------
-- 未ログイン（anon）: 読むのも書くのも、表の権限で断られる
-- -----------------------------------------------------------------------------
\echo '== anon =='
begin;
set local role anon;
select set_config('request.jwt.claims', '', true);
select test.check('chg_anon_cannot_read', test.flow(array[]::text[],
  $q$select test.visible(false)$q$), :'table_denied');
select test.check('chg_anon_cannot_insert', test.flow(
  array[$q$insert into public.announcements(title) values ('by_anon')$q$],
  $q$select test.n_title('by_anon')$q$), :'table_denied');
select test.check('chg_anon_cannot_update', test.flow(
  array[format($q$update public.announcements set title = 'by_anon' where id = %L$q$, :'A_gpub')],
  format($q$select test.title(%L)$q$, :'A_gpub')), :'table_denied');
select test.check('chg_anon_cannot_delete', test.flow(
  array[format($q$delete from public.announcements where id = %L$q$, :'A_gpub')],
  format($q$select test.title(%L)$q$, :'A_gpub')), :'table_denied');
commit;

-- -----------------------------------------------------------------------------
-- ログイン中で運営でない人（O1 member / owner / client・どの組織にも入っていない人）:
--   書き込みは全体向けも組織向けも断られる・読むのは公開中の全体向けと自分の組織向け
-- -----------------------------------------------------------------------------
\echo '== logged in, not an operator =='
begin;
set local role authenticated;
select set_config('request.jwt.claims', :'c_mem', true);
select test.check('chg_member_cannot_insert_global', test.flow(
  array[$q$insert into public.announcements(title) values ('by_mem')$q$],
  $q$select test.n_title('by_mem')$q$), :'rls_denied');
select test.check('same_member_cannot_insert_own_org', test.flow(
  array[format($q$insert into public.announcements(title, org_id) values ('by_mem', %L)$q$, :'O1')],
  $q$select test.n_title('by_mem')$q$), :'rls_denied');
select test.check('chg_member_cannot_update_global', test.flow(
  array[format($q$update public.announcements set title = 'by_mem' where id = %L$q$, :'A_gpub')],
  format($q$select test.title(%L)$q$, :'A_gpub')), 'ok:g_pub');
select test.check('same_member_cannot_update_own_org', test.flow(
  array[format($q$update public.announcements set title = 'by_mem' where id = %L$q$, :'A_o1pub')],
  format($q$select test.title(%L)$q$, :'A_o1pub')), 'ok:o1_pub');
select test.check('chg_member_cannot_delete_global', test.flow(
  array[format($q$delete from public.announcements where id = %L$q$, :'A_gpub')],
  format($q$select test.title(%L)$q$, :'A_gpub')), 'ok:g_pub');
select test.check('same_member_cannot_delete_own_org', test.flow(
  array[format($q$delete from public.announcements where id = %L$q$, :'A_o1pub')],
  format($q$select test.title(%L)$q$, :'A_o1pub')), 'ok:o1_pub');
-- truncate は RLS を通らない（表の権限で断る）
select test.check('chg_member_cannot_truncate', test.flow(
  array[$q$truncate public.announcements, public.announcement_reads$q$],
  $q$select test.n_title('g_pub')$q$), :'table_denied');
select test.check('same_member_reads_published', test.flow(array[]::text[],
  $q$select test.visible(true)$q$), 'ok:g_pub,o1_pub');
select test.check('chg_member_reads_only_published', test.flow(array[]::text[],
  $q$select test.visible(false)$q$), 'ok:g_pub,o1_pub');

select set_config('request.jwt.claims', :'c_own', true);
select test.check('same_owner_cannot_insert_own_org', test.flow(
  array[format($q$insert into public.announcements(title, org_id) values ('by_own', %L)$q$, :'O1')],
  $q$select test.n_title('by_own')$q$), :'rls_denied');
select test.check('chg_owner_cannot_insert_global', test.flow(
  array[$q$insert into public.announcements(title) values ('by_own')$q$],
  $q$select test.n_title('by_own')$q$), :'rls_denied');
select test.check('same_owner_reads_published', test.flow(array[]::text[],
  $q$select test.visible(true)$q$), 'ok:g_pub,o1_pub');

select set_config('request.jwt.claims', :'c_cl', true);
select test.check('chg_client_cannot_insert_global', test.flow(
  array[$q$insert into public.announcements(title) values ('by_cl')$q$],
  $q$select test.n_title('by_cl')$q$), :'rls_denied');
select test.check('same_client_reads_published', test.flow(array[]::text[],
  $q$select test.visible(true)$q$), 'ok:g_pub,o1_pub');

select set_config('request.jwt.claims', :'c_out', true);
select test.check('chg_outsider_cannot_insert_global', test.flow(
  array[$q$insert into public.announcements(title) values ('by_out')$q$],
  $q$select test.n_title('by_out')$q$), :'rls_denied');
select test.check('same_outsider_reads_published', test.flow(array[]::text[],
  $q$select test.visible(true)$q$), 'ok:g_pub');
commit;

-- -----------------------------------------------------------------------------
-- 運営（どの組織にも入っていない・二要素認証の登録なし）: 全体向けも組織向けも作れて、変えられて、消せる。全部読める
--   作るのは運営画面と同じく作った行を返す（insert … returning）。消すのは id で選ぶ。
-- -----------------------------------------------------------------------------
\echo '== operator (superadmin) =='
begin;
set local role authenticated;
select set_config('request.jwt.claims', :'c_sa', true);
select test.check('chg_superadmin_can_insert_org', test.flow(
  array[format($q$insert into public.announcements(title, body, category, org_id) values ('by_sa_o2', 'b', 'feature', %L) returning id, org_id, title, body, category, published, created_at$q$, :'O2')],
  $q$select test.n_title('by_sa_o2')$q$), 'ok:1');
select test.check('same_superadmin_can_insert_global', test.flow(
  array[$q$insert into public.announcements(title, body, category, org_id) values ('by_sa_all', 'b', 'info', null) returning id, org_id, title, body, category, published, created_at$q$],
  $q$select test.n_title('by_sa_all')$q$), 'ok:1');
select test.check('chg_superadmin_can_update_org', test.flow(
  array[format($q$update public.announcements set title = 'o2_edit' where id = %L$q$, :'A_o2pub')],
  format($q$select test.title(%L)$q$, :'A_o2pub')), 'ok:o2_edit');
select test.check('chg_superadmin_can_delete_org', test.flow(
  array[format($q$delete from public.announcements where id = %L$q$, :'A_o2pub')],
  format($q$select test.title(%L)$q$, :'A_o2pub')), 'ok:-');
select test.check('same_superadmin_can_delete_global', test.flow(
  array[format($q$delete from public.announcements where id = %L$q$, :'A_gpub')],
  format($q$select test.title(%L)$q$, :'A_gpub')), 'ok:-');
select test.check('chg_superadmin_reads_all', test.flow(array[]::text[],
  $q$select test.visible(false)$q$), 'ok:g_draft,g_pub,o1_draft,o1_pub,o2_pub');
commit;

-- 運営かどうかは SECURITY DEFINER の関数で見る（本人が profiles を読めなくても書ける）
begin;
revoke select on public.profiles from authenticated;
set local role authenticated;
select set_config('request.jwt.claims', :'c_sa', true);
select test.check('chg_superadmin_write_without_reading_profiles', test.flow(
  array[format($q$insert into public.announcements(title, org_id) values ('by_sa_noprof', %L) returning id$q$, :'O2')],
  $q$select test.n_title('by_sa_noprof')$q$), 'ok:1');
reset role;
grant select on public.profiles to authenticated;
commit;

-- -----------------------------------------------------------------------------
-- 運営で確認済みの認証アプリがある人: コード入力前（aal1）は二要素認証の RESTRICTIVE で断られ、入力後（aal2）は書ける
-- -----------------------------------------------------------------------------
\echo '== operator with an authenticator app =='
begin;
set local role authenticated;
select set_config('request.jwt.claims', :'c_sa2_aal1', true);
select test.check('same_mfa_blocks_operator_insert_without_code', test.flow(
  array[$q$insert into public.announcements(title) values ('by_sa2')$q$],
  $q$select test.n_title('by_sa2')$q$), :'rls_denied');
select test.check('same_mfa_blocks_operator_delete_without_code', test.flow(
  array[format($q$delete from public.announcements where id = %L$q$, :'A_gpub')],
  format($q$select test.title(%L)$q$, :'A_gpub')), 'ok:g_pub');
select set_config('request.jwt.claims', :'c_sa2_aal2', true);
select test.check('chg_mfa_operator_with_code_can_insert_org', test.flow(
  array[format($q$insert into public.announcements(title, org_id) values ('by_sa2_o2', %L) returning id$q$, :'O2')],
  $q$select test.n_title('by_sa2_o2')$q$), 'ok:1');
commit;

-- -----------------------------------------------------------------------------
-- service_role（運営画面のサーバー）: RLS を通らずに読み書きできる
-- -----------------------------------------------------------------------------
\echo '== service_role =='
begin;
set local role service_role;
select set_config('request.jwt.claims', '', true);
select test.check('same_service_role_can_write', test.flow(
  array[format($q$insert into public.announcements(title, org_id) values ('by_svc', %L)$q$, :'O2'),
        format($q$update public.announcements set title = 'svc_edit' where id = %L$q$, :'A_o1pub'),
        format($q$delete from public.announcements where id = %L$q$, :'A_gdraft')],
  format($q$select test.n_title('by_svc') || '|' || test.title(%L) || '|' || test.title(%L)$q$, :'A_o1pub', :'A_gdraft')),
  'ok:1|svc_edit|-');
select test.check('same_service_role_reads_all', test.flow(array[]::text[],
  $q$select test.visible(false)$q$), 'ok:g_draft,g_pub,o1_draft,o1_pub,o2_pub');
commit;

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
    raise exception 'ANNOUNCEMENTS WRITE OPERATORS CHECKS FAILED (% failures)', v_fail;
  end if;
end $$;
select 'ANNOUNCEMENTS WRITE OPERATORS CHECKS PASSED' as result;
