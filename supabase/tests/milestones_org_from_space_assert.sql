-- =============================================================================
-- マイルストーンの組織は、その space の組織から決める（*_milestones_org_from_space.sql）の挙動検証
-- 前提: run_milestones_org_from_space.sh が _local_bootstrap → Supabase の権限の代役 → migrations →
--   milestones_org_from_space_seed.sql → 本 migration（RED=1 のときは本 migration だけ流さない）。
--   データと人物は seed のとおり。
-- 画面と同じ書き込みは set role authenticated ＋ request.jwt.claims（RLS を通る）。
--
-- label:
--   chg_*    本 migration で変わるもの（適用前は FAIL・適用後は PASS であるべき）
--   same_*   本 migration で変えないもの（両方で PASS）
-- 出力: PASS[label] / FAIL[label]。最後に FAIL が 0 件なら "MILESTONES ORG FROM SPACE CHECKS PASSED"。
--   1件でもあれば例外で終了する。書き込みはサブトランザクションで実行し、必ず巻き戻す（各 assert は独立）。
-- =============================================================================
set client_min_messages = notice;

\set O1 '00000000-0000-0000-0000-00000000a001'
\set O2 '00000000-0000-0000-0000-00000000a002'
\set S1 '00000000-0000-0000-0000-00000000b001'
\set S2 '00000000-0000-0000-0000-00000000b002'
\set M0 '00000000-0000-0000-0000-00000000e000'
\set M1 '00000000-0000-0000-0000-00000000e001'
\set c_ed '{"sub":"00000000-0000-0000-0000-00000000c002","role":"authenticated"}'
\set c_vw '{"sub":"00000000-0000-0000-0000-00000000c003","role":"authenticated"}'
\set c_cl '{"sub":"00000000-0000-0000-0000-00000000c004","role":"authenticated"}'

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

-- マイルストーンの組織と space を、RLS に隠されずに読む
create or replace function test.ms_scope(p_id uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  select m.org_id::text || '/' || m.space_id::text into v from public.milestones m where m.id = p_id;
  if not found then return '(no row)'; end if;
  return v;
end $$;

-- 関数を作る migration が「既定の実行権を付けない」ので、補助関数は明示で grant する
grant execute on all functions in schema test to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 形: BEFORE INSERT OR UPDATE OF space_id, org_id のトリガー・関数は SECURITY DEFINER と search_path = public・
--   関数は直接実行できない（トリガー専用）
-- -----------------------------------------------------------------------------
\echo '== shape =='
select test.check('chg_trigger_shape', (
  select coalesce(string_agg(format('%s:%s:%s', t.tgname, t.tgenabled::text,
                                    (pg_get_triggerdef(t.oid) like '%BEFORE INSERT OR UPDATE OF space_id, org_id ON public.milestones FOR EACH ROW%')::text),
                             ','), 'none')
  from pg_trigger t
  where t.tgrelid = 'public.milestones'::regclass and not t.tgisinternal
), 'trg_milestones_fill_org:O:true');

select test.check('chg_function_shape', (
  select coalesce((select format('definer=%s config=%s public=%s anon=%s authenticated=%s service_role=%s',
                                 p.prosecdef::text, array_to_string(p.proconfig, ';'),
                                 has_function_privilege('public', p.oid, 'execute')::text,
                                 has_function_privilege('anon', p.oid, 'execute')::text,
                                 has_function_privilege('authenticated', p.oid, 'execute')::text,
                                 has_function_privilege('service_role', p.oid, 'execute')::text)
                     from pg_proc p where p.oid = to_regprocedure('public.milestones_fill_org()')), 'missing')
), 'definer=true config=search_path=public public=false anon=false authenticated=false service_role=false');

-- RLS の insert / update の with check は org_id を見る（本 migration では変えない。トリガーで埋めた後の値で判定される）
select test.check('same_rls_with_check_uses_org_id', (
  select string_agg(policyname || ': ' || coalesce(with_check, '-'), ' | ' order by policyname collate "C")
  from pg_policies
  where schemaname = 'public' and tablename = 'milestones' and cmd in ('INSERT', 'UPDATE')
), 'milestones_insert_member: app_can_write_space(space_id, org_id) | milestones_update_member: app_can_write_space(space_id, org_id)');

-- 既にある行は変わらない
select test.check('same_existing_row_unchanged', (
  select format('%s/%s/%s/%s/%s', m.org_id, m.space_id, m.name, m.order_key, (m.created_at = '2026-09-01 00:00:00+00')::text)
  from public.milestones m where m.id = :'M0'
), :'O1' || '/' || :'S1' || '/m0/1/true');

-- -----------------------------------------------------------------------------
-- 作る: 組織を渡さなくても・別の組織を渡しても、space の組織になる
-- -----------------------------------------------------------------------------
\echo '== insert =='
-- 社内の editor が、画面と同じ権限で組織を渡さずに作る
begin;
set local role authenticated;
select set_config('request.jwt.claims', :'c_ed', true);
select test.check('chg_editor_inserts_without_org', test.flow(
  array[format('insert into public.milestones(id, space_id, name) values (%L, %L, %L)', :'M1', :'S1', 'm1')],
  format('select test.ms_scope(%L)', :'M1')), 'ok:' || :'O1' || '/' || :'S1');
-- 別の組織を渡しても space の組織に上書きされ、RLS の with check も埋めた後の値（S1 の組織）で通る
select test.check('chg_editor_other_org_overwritten', test.flow(
  array[format('insert into public.milestones(id, org_id, space_id, name) values (%L, %L, %L, %L)', :'M1', :'O2', :'S1', 'm1')],
  format('select test.ms_scope(%L)', :'M1')), 'ok:' || :'O1' || '/' || :'S1');
-- 別の組織の space には作れない（自分の組織を渡しても組織は space の組織になり、RLS の with check で止まる）
select test.check('same_editor_cannot_insert_into_other_org_space', test.flow(
  array[format('insert into public.milestones(id, org_id, space_id, name) values (%L, %L, %L, %L)', :'M1', :'O1', :'S2', 'm1')],
  format('select test.ms_scope(%L)', :'M1')), 'like:err:42501:%');

-- 閲覧者・相手先は今までどおり作れない（RLS）
select set_config('request.jwt.claims', :'c_vw', true);
select test.check('same_viewer_cannot_insert', test.flow(
  array[format('insert into public.milestones(id, org_id, space_id, name) values (%L, %L, %L, %L)', :'M1', :'O1', :'S1', 'm1')],
  format('select test.ms_scope(%L)', :'M1')), 'like:err:42501:%');
select set_config('request.jwt.claims', :'c_cl', true);
select test.check('same_client_cannot_insert', test.flow(
  array[format('insert into public.milestones(id, org_id, space_id, name) values (%L, %L, %L, %L)', :'M1', :'O1', :'S1', 'm1')],
  format('select test.ms_scope(%L)', :'M1')), 'like:err:42501:%');
commit;

begin;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select test.check('same_anon_cannot_insert', test.flow(
  array[format('insert into public.milestones(id, org_id, space_id, name) values (%L, %L, %L, %L)', :'M1', :'O1', :'S1', 'm1')],
  format('select test.ms_scope(%L)', :'M1')), 'like:err:42501:%');
commit;

-- サーバー（service_role）も組織を渡さずに作れる
begin;
set local role service_role;
select test.check('chg_service_role_inserts_without_org', test.flow(
  array[format('insert into public.milestones(id, space_id, name) values (%L, %L, %L)', :'M1', :'S1', 'm1')],
  format('select test.ms_scope(%L)', :'M1')), 'ok:' || :'O1' || '/' || :'S1');
commit;

-- -----------------------------------------------------------------------------
-- 変える: 組織を別の値に書き換えても space の組織に戻る。space を移すと、移した先の space の組織になる
-- -----------------------------------------------------------------------------
\echo '== update =='
-- 社内の editor が画面と同じ権限で組織を別の値に書き換えても、space の組織に戻る（RLS の with check も戻した値で通る）
begin;
set local role authenticated;
select set_config('request.jwt.claims', :'c_ed', true);
select test.check('chg_editor_update_org_resets_to_space_org', test.flow(
  array[format('update public.milestones set org_id = %L where id = %L', :'O2', :'M0')],
  format('select test.ms_scope(%L)', :'M0')), 'ok:' || :'O1' || '/' || :'S1');
-- 別の組織の space へは移せない（組織は移した先の space の組織になり、RLS の with check で止まる）
select test.check('same_editor_cannot_move_to_other_org_space', test.flow(
  array[format('update public.milestones set space_id = %L where id = %L', :'S2', :'M0')],
  format('select test.ms_scope(%L)', :'M0')), 'like:err:42501:%');
commit;

-- RLS を通らない書き手（postgres）でも同じ
select test.check('chg_update_org_resets_to_space_org', test.flow(
  array[format('update public.milestones set org_id = %L where id = %L', :'O2', :'M0')],
  format('select test.ms_scope(%L)', :'M0')), 'ok:' || :'O1' || '/' || :'S1');
select test.check('chg_update_space_takes_its_org', test.flow(
  array[format('update public.milestones set space_id = %L where id = %L', :'S2', :'M0')],
  format('select test.ms_scope(%L)', :'M0')), 'ok:' || :'O2' || '/' || :'S2');

-- 巻き戻したので、行は M0 だけで変わっていない
select test.check('same_checks_left_no_change', (
  select format('count=%s m0=%s', (select count(*) from public.milestones), test.ms_scope(:'M0'))
), 'count=1 m0=' || :'O1' || '/' || :'S1');

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
    raise exception 'MILESTONES ORG FROM SPACE CHECKS FAILED (% failures)', v_fail;
  end if;
end $$;
select 'MILESTONES ORG FROM SPACE CHECKS PASSED' as result;
