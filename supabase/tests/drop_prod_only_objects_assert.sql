-- =============================================================================
-- 本番にだけある物を無くす（*_drop_prod_only_objects.sql）の挙動検証
-- 前提: run_drop_prod_only_objects.sh が _local_bootstrap → Supabase の権限の代役 → migrations →
--   drop_prod_only_objects_seed.sql（本番にだけある物を作る）→ 本 migration（RED=1 のときは本 migration だけ流さない）。
-- 書き込みはサブトランザクションで実行し、必ず巻き戻す（各 assert は独立）。
--
-- label:
--   chg_*    本 migration で変わるもの（適用前は FAIL・適用後は PASS であるべき）
--   same_*   本 migration で変えないもの（両方で PASS）
-- 出力: PASS[label] / FAIL[label]。最後に FAIL が 0 件なら "DROP PROD ONLY CHECKS PASSED"。
--   1件でもあれば例外で終了する。
-- =============================================================================
set client_min_messages = notice;

\set O1 '00000000-0000-0000-0000-00000000a001'
\set S1 '00000000-0000-0000-0000-00000000b001'
\set u_ed '00000000-0000-0000-0000-00000000c002'
\set M1 '00000000-0000-0000-0000-00000000d001'
\set c_ed '{"sub":"00000000-0000-0000-0000-00000000c002","role":"authenticated"}'

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

-- マイルストーンの行数（RLS に関係なく数える）
create or replace function test.milestones(p_space uuid)
returns text language sql stable security definer set search_path = public as $$
  select count(*)::text from public.milestones where space_id = p_space
$$;

-- 関数を作る migration が「既定の実行権を付けない」ので、補助関数は明示で grant する
grant execute on all functions in schema test to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 無くなる物
-- -----------------------------------------------------------------------------
\echo '== dropped =='
select test.check('chg_user_preferences_table_gone',
  coalesce(to_regclass('public.user_preferences')::text, 'gone'), 'gone');
select test.check('chg_user_preferences_updated_at_function_gone',
  coalesce(to_regprocedure('public.update_user_preferences_updated_at()')::text, 'gone'), 'gone');
select test.check('chg_user_preferences_policies_gone', (
  select count(*)::text from pg_policies where schemaname = 'public' and tablename = 'user_preferences'
), '0');
select test.check('chg_milestones_status_column_gone', (
  select coalesce(string_agg(a.attname::text, ','), 'gone')
    from pg_attribute a
   where a.attrelid = 'public.milestones'::regclass and a.attname = 'status' and not a.attisdropped
), 'gone');

-- 実際に書けないこと（表・列が無い）
select test.check('chg_insert_into_user_preferences_fails', test.flow(
  array[format('insert into public.user_preferences(user_id) values (%L)', :'u_ed')],
  'select count(*)::text from public.user_preferences'), 'like:err:42P01:%');
select test.check('chg_write_milestones_status_fails', test.flow(
  array[format('update public.milestones set status = %L where id = %L', 'done', :'M1')],
  'select count(*)::text from public.milestones where status = ''done'''), 'like:err:42703:%');

-- -----------------------------------------------------------------------------
-- 変わらない物
-- -----------------------------------------------------------------------------
\echo '== kept =='
select test.check('same_milestones_rows_kept', test.val(format('select test.milestones(%L)', :'S1')), 'ok:3');
select test.check('same_milestones_columns', (
  select string_agg(a.attname::text, ',' order by a.attnum)
    from pg_attribute a
   where a.attrelid = 'public.milestones'::regclass and a.attnum > 0 and not a.attisdropped
     and a.attname <> 'status'
), 'id,org_id,space_id,name,due_date,order_key,created_at,start_date,completed_at');

-- 画面の操作（社内の編集者がマイルストーンを作る・並べ替える）は今までどおり
begin;
set local role authenticated;
select set_config('request.jwt.claims', :'c_ed', true);
select test.check('same_editor_can_create_milestone', test.flow(
  array[format('insert into public.milestones(org_id, space_id, name, due_date, order_key) values (%L, %L, %L, %L, %L)',
               :'O1', :'S1', 'm4', '2027-01-01', 4)],
  format('select test.milestones(%L)', :'S1')), 'ok:4');
select test.check('same_editor_can_rename_milestone', test.flow(
  array[format('update public.milestones set name = %L where id = %L', 'm1-renamed', :'M1')],
  format('select name from public.milestones where id = %L', :'M1')), 'ok:m1-renamed');
select test.check('same_editor_reads_milestones', test.val(
  format('select count(*)::text from public.milestones where space_id = %L', :'S1')), 'ok:3');
commit;

-- 二要素認証の RESTRICTIVE: RLS が有効な public の全表にある（表が1つ減っても漏れが出ない）
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
    raise exception 'DROP PROD ONLY CHECKS FAILED (% failures)', v_fail;
  end if;
end $$;
select 'DROP PROD ONLY CHECKS PASSED' as result;
