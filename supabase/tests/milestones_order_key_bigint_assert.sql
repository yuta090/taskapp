-- =============================================================================
-- マイルストーンの並び順は bigint（*_milestones_order_key_bigint.sql）の挙動検証
-- 前提: run_milestones_order_key_bigint.sh が _local_bootstrap → Supabase の権限の代役 → migrations →
--   milestones_order_key_bigint_seed.sql → 本 migration（RED=1 のときは本 migration だけ流さない）。
--   データと人物は seed のとおり。
-- 画面と同じ書き込みは set role authenticated ＋ request.jwt.claims（RLS を通る）。
-- CLI / MCP の道具と同じ書き込みは set role service_role。
--
-- label:
--   chg_*    本 migration で変わるもの（適用前は FAIL・適用後は PASS であるべき）
--   same_*   本 migration で変えないもの（両方で PASS）
-- 出力: PASS[label] / FAIL[label]。最後に FAIL が 0 件なら "MILESTONES ORDER KEY BIGINT CHECKS PASSED"。
--   1件でもあれば例外で終了する。書き込みはサブトランザクションで実行し、必ず巻き戻す（各 assert は独立）。
-- =============================================================================
set client_min_messages = notice;

\set O1 '00000000-0000-0000-0000-00000000a001'
\set S1 '00000000-0000-0000-0000-00000000b001'
\set S2 '00000000-0000-0000-0000-00000000b002'
\set M1 '00000000-0000-0000-0000-00000000e001'
\set MN '00000000-0000-0000-0000-00000000e010'
\set MS '00000000-0000-0000-0000-00000000e011'
\set c_ed '{"sub":"00000000-0000-0000-0000-00000000c002","role":"authenticated"}'
\set c_own '{"sub":"00000000-0000-0000-0000-00000000c001","role":"authenticated"}'
-- 画面の Date.now()（ミリ秒）と、MCP の Math.floor(Date.now() / 1000)（秒）に当たる値
\set ms_key 1757649600000
\set sec_key 1757649600

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

-- マイルストーンを RLS に隠されずに読む
create or replace function test.ms_row(p_id uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  select m.org_id::text || '/' || m.space_id::text || '/' || coalesce(m.order_key::text, 'null') into v
    from public.milestones m where m.id = p_id;
  if not found then return '(no row)'; end if;
  return v;
end $$;

-- space のマイルストーンの並び（order_key の昇順。画面・MCP・ポータルと同じ並べ方）
create or replace function test.order_in_space(p_space uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(string_agg(m.name, ',' order by m.order_key, m.name), '(none)')
    from public.milestones m where m.space_id = p_space
$$;

create or replace function test.keys_in_space(p_space uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(string_agg(m.name || '=' || coalesce(m.order_key::text, 'null'), ',' order by m.order_key, m.name), '(none)')
    from public.milestones m where m.space_id = p_space
$$;

-- 関数を作る migration が「既定の実行権を付けない」ので、補助関数は明示で grant する
grant execute on all functions in schema test to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 形と、既にある行
-- -----------------------------------------------------------------------------
\echo '== shape / existing rows =='
select test.check('chg_order_key_is_bigint', (
  select format_type(a.atttypid, a.atttypmod) from pg_attribute a
   where a.attrelid = 'public.milestones'::regclass and a.attname = 'order_key' and not a.attisdropped
), 'bigint');

select test.check('same_order_key_nullable_without_default', (
  select format('nullable=%s default=%s', (not a.attnotnull)::text, coalesce(pg_get_expr(d.adbin, d.adrelid), 'none'))
    from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where a.attrelid = 'public.milestones'::regclass and a.attname = 'order_key' and not a.attisdropped
), 'nullable=true default=none');

select test.check('same_existing_rows_unchanged', test.keys_in_space(:'S1'), 'm1=1,m2=2,m3=3');
select test.check('same_existing_order_unchanged', test.order_in_space(:'S1'), 'm1,m2,m3');

-- 相手先向けのビュー（order_key を使わない）は今までどおり読める
select test.check('same_client_view_reads', (select count(*)::text from public.v_client_milestones), '0');

-- -----------------------------------------------------------------------------
-- 画面と同じ書き込み: 社内の editor が組織を渡さずに作る（組織はトリガーで space の組織になる）
-- -----------------------------------------------------------------------------
\echo '== editor (画面) =='
begin;
set local role authenticated;
select set_config('request.jwt.claims', :'c_ed', true);
select test.check('chg_editor_inserts_ms_order_key', test.flow(
  array[format('insert into public.milestones(id, space_id, name, order_key) values (%L, %L, %L, %s)', :'MN', :'S1', 'ms', :ms_key)],
  format('select test.ms_row(%L)', :'MN')), 'ok:' || :'O1' || '/' || :'S1' || '/' || :'ms_key');
select test.check('same_editor_inserts_sec_order_key', test.flow(
  array[format('insert into public.milestones(id, space_id, name, order_key) values (%L, %L, %L, %s)', :'MS', :'S1', 'sec', :sec_key)],
  format('select test.ms_row(%L)', :'MS')), 'ok:' || :'O1' || '/' || :'S1' || '/' || :'sec_key');
-- 並びは order_key の昇順のまま（既にある 1〜3 → 秒 → ミリ秒）
select test.check('chg_order_follows_order_key', test.flow(
  array[format('insert into public.milestones(id, space_id, name, order_key) values (%L, %L, %L, %s)', :'MS', :'S1', 'sec', :sec_key),
        format('insert into public.milestones(id, space_id, name, order_key) values (%L, %L, %L, %s)', :'MN', :'S1', 'ms', :ms_key)],
  format('select test.order_in_space(%L)', :'S1')), 'ok:m1,m2,m3,sec,ms');
-- 並べ替えで order_key をミリ秒に書き換える
select test.check('chg_editor_updates_to_ms_order_key', test.flow(
  array[format('update public.milestones set order_key = %s where id = %L', :ms_key, :'M1')],
  format('select test.order_in_space(%L)', :'S1')), 'ok:m2,m3,m1');
commit;

-- -----------------------------------------------------------------------------
-- CLI / MCP と同じ書き込み（秒の order_key）
-- -----------------------------------------------------------------------------
\echo '== service_role (CLI / MCP) =='
begin;
set local role service_role;
select test.check('same_service_role_inserts_sec_order_key', test.flow(
  array[format('insert into public.milestones(id, org_id, space_id, name, order_key) values (%L, %L, %L, %L, %s)', :'MS', :'O1', :'S1', 'sec', :sec_key)],
  format('select test.ms_row(%L)', :'MS')), 'ok:' || :'O1' || '/' || :'S1' || '/' || :'sec_key');
commit;

-- -----------------------------------------------------------------------------
-- プリセットの RPC（order_key を numeric で受け取って入れる）
-- -----------------------------------------------------------------------------
\echo '== preset RPC =='
begin;
set local role authenticated;
select set_config('request.jwt.claims', :'c_own', true);
select test.check('same_preset_rpc_order_keys', test.flow(
  array[format('select public.rpc_apply_preset_to_space(%L, %L, %L::jsonb, %L::jsonb, null)', :'S2', 'new_business',
               '[{"name": "p1", "order_key": 1}, {"name": "p2", "order_key": 2}]', '[]')],
  format('select test.keys_in_space(%L)', :'S2')), 'ok:p1=1,p2=2');
select test.check('chg_preset_rpc_ms_order_key', test.flow(
  array[format('select public.rpc_apply_preset_to_space(%L, %L, %L::jsonb, %L::jsonb, null)', :'S2', 'new_business',
               format('[{"name": "p1", "order_key": %s}]', :ms_key), '[]')],
  format('select test.keys_in_space(%L)', :'S2')), 'ok:p1=' || :'ms_key');
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
    raise exception 'MILESTONES ORDER KEY BIGINT CHECKS FAILED (% failures)', v_fail;
  end if;
end $$;
select 'MILESTONES ORDER KEY BIGINT CHECKS PASSED' as result;
