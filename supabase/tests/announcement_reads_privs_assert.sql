-- =============================================================================
-- お知らせの既読（*_announcement_reads_privs.sql）の挙動検証
-- 前提: run_announcement_reads_privs.sh が _local_bootstrap → Supabase の権限の代役 → migrations（本 migration の手前まで）→
--   announcement_reads_privs_seed.sql → 本 migration（RED=1 のときは本 migration だけ流さない）。データと人物は seed のとおり。
-- ベルと同じ読み書きは set role authenticated ＋ request.jwt.claims（RLS を通る）。既読の付け方はベルと同じ upsert
--   （PostgREST が作る insert … on conflict (announcement_id, user_id) do update set 送った列 = excluded.送った列）。
-- 運営画面のサーバーと同じ読み書きは set role service_role（RLS を通らない）。未ログインは set role anon。
--
-- label:
--   chg_*    本 migration で変わるもの（適用前は FAIL・適用後は PASS であるべき）
--   same_*   本 migration で変えないもの（両方で PASS）
-- 出力: PASS[label] / FAIL[label]。最後に FAIL が 0 件なら "ANNOUNCEMENT READS PRIVS CHECKS PASSED"。
--   1件でもあれば例外で終了する。書き込みはサブトランザクションで実行し、必ず巻き戻す（各 assert は独立）。
-- =============================================================================
set client_min_messages = notice;

\set A1 '00000000-0000-0000-0000-00000000e001'
\set A2 '00000000-0000-0000-0000-00000000e002'
\set u1 '00000000-0000-0000-0000-00000000c001'
\set u2 '00000000-0000-0000-0000-00000000c002'
\set u3 '00000000-0000-0000-0000-00000000c003'
\set c_u1 '{"sub":"00000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal1"}'
\set c_u3_aal1 '{"sub":"00000000-0000-0000-0000-00000000c003","role":"authenticated","aal":"aal1"}'
\set c_u3_aal2 '{"sub":"00000000-0000-0000-0000-00000000c003","role":"authenticated","aal":"aal2"}'
-- ベルと同じ upsert（1行・2行）
\set upsert1 'insert into public.announcement_reads(announcement_id, user_id) values (%L, %L) on conflict (announcement_id, user_id) do update set announcement_id = excluded.announcement_id, user_id = excluded.user_id'
\set upsert2 'insert into public.announcement_reads(announcement_id, user_id) values (%L, %L), (%L, %L) on conflict (announcement_id, user_id) do update set announcement_id = excluded.announcement_id, user_id = excluded.user_id'
-- 断られ方: RLS の条件で断られる／表の権限で断られる
\set rls_denied 'like:err:42501:new row violates row-level security policy%'
\set table_denied 'err:42501:permission denied for table announcement_reads'

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

-- その人が既読にしたお知らせのタイトル（無ければ -）。RLS に隠されずに読む
create or replace function test.reads(p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(string_agg(a.title, ',' order by a.title collate "C"), '-')
    from public.announcement_reads r join public.announcements a on a.id = r.announcement_id
   where r.user_id = p_user
$$;

-- その人のそのお知らせの既読の日（UTC の日付。行が無ければ -）。RLS に隠されずに読む
create or replace function test.read_at(p_announcement uuid, p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select to_char(r.read_at at time zone 'UTC', 'YYYY-MM-DD')
                     from public.announcement_reads r
                    where r.announcement_id = p_announcement and r.user_id = p_user), '-')
$$;

-- 呼んだ人に見える既読の行（RLS を通る。人の id の末尾4桁 / お知らせの id の末尾4桁）
create or replace function test.visible_reads()
returns text language sql stable security invoker as $$
  select coalesce(string_agg(right(r.user_id::text, 4) || '/' || right(r.announcement_id::text, 4), ','
                             order by r.user_id, r.announcement_id), '-')
    from public.announcement_reads r
$$;

-- 条件の文字列（空白をつめて public. を外す）
create or replace function test.norm(p_expr text)
returns text language sql immutable as $$
  select regexp_replace(replace(coalesce(p_expr, ''), 'public.', ''), '\s+', ' ', 'g')
$$;

-- そのポリシーの形（無ければ (none)）
create or replace function test.policy(p_name text)
returns text language sql stable as $$
  select coalesce((select format('%s|%s|%s|%s|%s', p.permissive, p.roles::text, p.cmd, test.norm(p.qual), test.norm(p.with_check))
                     from pg_policies p
                    where p.schemaname = 'public' and p.tablename = 'announcement_reads' and p.policyname = p_name), '(none)')
$$;

-- その役割が announcement_reads に持っている表の権限（アルファベット順。無ければ -）
create or replace function test.privs(p_role text)
returns text language sql stable as $$
  select coalesce(string_agg(x.priv, ',' order by x.priv collate "C"), '-')
    from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) as x(priv)
   where has_table_privilege(p_role, 'public.announcement_reads', x.priv)
$$;

-- 関数を作る migration が「既定の実行権を付けない」ので、補助関数は明示で grant する
grant execute on all functions in schema test to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 形: ポリシー・表の権限・既にある行
-- -----------------------------------------------------------------------------
\echo '== shape =='
select test.check('chg_update_policy_own_row', test.policy('Users can update own announcement_reads'),
  'PERMISSIVE|{authenticated}|UPDATE|(user_id = ( SELECT auth.uid() AS uid))|(user_id = ( SELECT auth.uid() AS uid))');
select test.check('same_read_policy_unchanged', test.policy('Users can read own announcement_reads'),
  'PERMISSIVE|{public}|SELECT|(user_id = auth.uid())|');
select test.check('same_insert_policy_unchanged', test.policy('Users can mark announcements read'),
  'PERMISSIVE|{public}|INSERT||(user_id = auth.uid())');
select test.check('same_mfa_policy_kept', test.policy('mfa_required_when_enrolled'),
  'RESTRICTIVE|{authenticated}|ALL|( SELECT mfa_satisfied() AS mfa_satisfied)|( SELECT mfa_satisfied() AS mfa_satisfied)');
select test.check('same_no_delete_or_all_permissive_policy', (
  select count(*)::text from pg_policies p
   where p.schemaname = 'public' and p.tablename = 'announcement_reads'
     and p.permissive = 'PERMISSIVE' and p.cmd in ('DELETE', 'ALL')
), '0');

-- 二要素認証の RESTRICTIVE: RLS が有効な public の全表にある
select test.check('same_mfa_on_all_rls_tables', (
  select count(*)::text from pg_tables t
  where t.schemaname = 'public' and t.rowsecurity
    and not exists (select 1 from pg_policies p
                    where p.schemaname = 'public' and p.tablename = t.tablename
                      and p.policyname = 'mfa_required_when_enrolled')
), '0');

select test.check('same_rls_enabled', (
  select c.relrowsecurity::text from pg_class c where c.oid = 'public.announcement_reads'::regclass
), 'true');

select test.check('chg_anon_has_no_table_privileges', test.privs('anon'), '-');
select test.check('chg_anon_has_no_acl_entry', (
  select count(*)::text from pg_class c, aclexplode(c.relacl) a
   where c.oid = 'public.announcement_reads'::regclass and a.grantee = 'anon'::regrole
), '0');
select test.check('chg_authenticated_table_privileges', test.privs('authenticated'), 'DELETE,INSERT,SELECT,UPDATE');
select test.check('same_service_role_table_privileges', test.privs('service_role'),
  'DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE');

select test.check('same_rows_kept', (
  select string_agg(right(r.user_id::text, 4) || '/' || right(r.announcement_id::text, 4) || '@'
                    || to_char(r.read_at at time zone 'UTC', 'YYYY-MM-DD'), ',' order by r.user_id, r.announcement_id)
    from public.announcement_reads r
), 'c001/e001@2026-01-01,c002/e001@2026-01-02,c003/e001@2026-01-03');

-- -----------------------------------------------------------------------------
-- 未ログイン（anon）: 読むのも書くのも、表の権限で断られる
-- -----------------------------------------------------------------------------
\echo '== anon =='
begin;
set local role anon;
select set_config('request.jwt.claims', '', true);
select test.check('chg_anon_cannot_read', test.flow(array[]::text[],
  $q$select test.visible_reads()$q$), :'table_denied');
select test.check('chg_anon_cannot_insert', test.flow(
  array[format(:'upsert1', :'A2', :'u1')],
  format($q$select test.reads(%L)$q$, :'u1')), :'table_denied');
select test.check('chg_anon_cannot_update', test.flow(
  array[format($q$update public.announcement_reads set read_at = '2030-01-01T00:00:00Z' where announcement_id = %L$q$, :'A1')],
  format($q$select test.read_at(%L, %L)$q$, :'A1', :'u1')), :'table_denied');
select test.check('chg_anon_cannot_delete', test.flow(
  array[format($q$delete from public.announcement_reads where announcement_id = %L$q$, :'A1')],
  format($q$select test.reads(%L)$q$, :'u1')), :'table_denied');
commit;

-- -----------------------------------------------------------------------------
-- ログイン中の本人（u1）: 1回目も2回目も既読にできる・自分の行だけ読める・書き換えられる。他人の行は書き換えられない
-- -----------------------------------------------------------------------------
\echo '== logged in (u1) =='
begin;
set local role authenticated;
select set_config('request.jwt.claims', :'c_u1', true);
select test.check('same_user_marks_read_first_time', test.flow(
  array[format(:'upsert1', :'A2', :'u1')],
  format($q$select test.reads(%L)$q$, :'u1')), 'ok:a1,a2');
-- 同じお知らせをもう一度既読にする（既にある行と重なる → on conflict do update）
select test.check('chg_user_marks_read_twice', test.flow(
  array[format(:'upsert1', :'A1', :'u1')],
  format($q$select test.reads(%L) || '|' || test.read_at(%L, %L)$q$, :'u1', :'A1', :'u1')), 'ok:a1|2026-01-01');
-- 「すべて既読」: 既読のものが1つ混ざっていても通る
select test.check('chg_user_marks_all_with_one_already_read', test.flow(
  array[format(:'upsert2', :'A1', :'u1', :'A2', :'u1')],
  format($q$select test.reads(%L)$q$, :'u1')), 'ok:a1,a2');
select test.check('chg_user_can_update_own_read_at', test.flow(
  array[format($q$update public.announcement_reads set read_at = '2030-01-01T00:00:00Z' where announcement_id = %L$q$, :'A1')],
  format($q$select 'u1:' || test.read_at(%L, %L) || ' u2:' || test.read_at(%L, %L)$q$, :'A1', :'u1', :'A1', :'u2')),
  'ok:u1:2030-01-01 u2:2026-01-02');
select test.check('same_user_cannot_update_others_read_at', test.flow(
  array[format($q$update public.announcement_reads set read_at = '2030-01-01T00:00:00Z' where announcement_id = %L and user_id = %L$q$, :'A1', :'u2')],
  format($q$select test.read_at(%L, %L)$q$, :'A1', :'u2')), 'ok:2026-01-02');
-- 他人の既読と重なる upsert（他人の行の書き換え）は、付ける時点で断られる
select test.check('same_user_cannot_upsert_for_other', test.flow(
  array[format(:'upsert1', :'A1', :'u2')],
  format($q$select test.read_at(%L, %L)$q$, :'A1', :'u2')), :'rls_denied');
-- 自分の行を他人の行に書き換えることはできない
select test.check('chg_user_cannot_move_own_row_to_other', test.flow(
  array[format($q$update public.announcement_reads set user_id = %L, announcement_id = %L where announcement_id = %L and user_id = %L$q$, :'u2', :'A2', :'A1', :'u1')],
  format($q$select test.reads(%L) || '|' || test.reads(%L)$q$, :'u1', :'u2')), :'rls_denied');
select test.check('same_user_reads_own_only', test.flow(array[]::text[],
  $q$select test.visible_reads()$q$), 'ok:c001/e001');
select test.check('same_user_cannot_delete_own', test.flow(
  array[format($q$delete from public.announcement_reads where announcement_id = %L$q$, :'A1')],
  format($q$select test.reads(%L)$q$, :'u1')), 'ok:a1');
-- truncate は RLS を通らない（表の権限で断る）
select test.check('chg_user_cannot_truncate', test.flow(
  array[$q$truncate public.announcement_reads$q$],
  format($q$select test.reads(%L)$q$, :'u2')), :'table_denied');
commit;

-- -----------------------------------------------------------------------------
-- 確認済みの認証アプリがある人（u3）: コード入力前（aal1）は二要素認証の RESTRICTIVE で断られ、入力後（aal2）は2回目も既読にできる
-- -----------------------------------------------------------------------------
\echo '== logged in with an authenticator app (u3) =='
begin;
set local role authenticated;
select set_config('request.jwt.claims', :'c_u3_aal1', true);
select test.check('same_mfa_blocks_upsert_without_code', test.flow(
  array[format(:'upsert1', :'A1', :'u3')],
  format($q$select test.reads(%L)$q$, :'u3')), :'rls_denied');
select test.check('same_mfa_blocks_update_without_code', test.flow(
  array[format($q$update public.announcement_reads set read_at = '2030-01-01T00:00:00Z' where announcement_id = %L$q$, :'A1')],
  format($q$select test.read_at(%L, %L)$q$, :'A1', :'u3')), 'ok:2026-01-03');
select set_config('request.jwt.claims', :'c_u3_aal2', true);
select test.check('chg_mfa_user_with_code_marks_read_twice', test.flow(
  array[format(:'upsert1', :'A1', :'u3')],
  format($q$select test.reads(%L) || '|' || test.read_at(%L, %L)$q$, :'u3', :'A1', :'u3')), 'ok:a1|2026-01-03');
commit;

-- -----------------------------------------------------------------------------
-- service_role（運営画面のサーバー）: RLS を通らずに読み書きできる
-- -----------------------------------------------------------------------------
\echo '== service_role =='
begin;
set local role service_role;
select set_config('request.jwt.claims', '', true);
select test.check('same_service_role_can_write', test.flow(
  array[format(:'upsert1', :'A1', :'u1'),
        format($q$update public.announcement_reads set read_at = '2030-01-01T00:00:00Z' where announcement_id = %L and user_id = %L$q$, :'A1', :'u2'),
        format($q$delete from public.announcement_reads where announcement_id = %L and user_id = %L$q$, :'A1', :'u3')],
  format($q$select test.reads(%L) || '|' || test.read_at(%L, %L) || '|' || test.read_at(%L, %L)$q$, :'u1', :'A1', :'u2', :'A1', :'u3')),
  'ok:a1|2030-01-01|-');
select test.check('same_service_role_reads_all', test.flow(array[]::text[],
  $q$select test.visible_reads()$q$), 'ok:c001/e001,c002/e001,c003/e001');
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
    raise exception 'ANNOUNCEMENT READS PRIVS CHECKS FAILED (% failures)', v_fail;
  end if;
end $$;
select 'ANNOUNCEMENT READS PRIVS CHECKS PASSED' as result;
