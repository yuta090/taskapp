-- =============================================================================
-- タスクの担当の招待は同じ space の招待だけ（*_task_assignee_invite_same_space.sql）の挙動検証
-- 前提: run_task_assignee_invite_same_space.sh が _local_bootstrap → Supabase の権限の代役 → migrations →
--   task_assignee_invite_same_space_seed.sql → 本 migration（RED=1 のときは本 migration だけ流さない）。
--   データと人物は seed のとおり。
-- 書き込みはサブトランザクションで実行し、必ず巻き戻す（各 assert は独立）。
-- 画面と同じ書き込みは set role authenticated ＋ request.jwt.claims（RLS を通る）。サーバーは set role service_role。
--
-- label:
--   chg_*    本 migration で変わるもの（適用前は FAIL・適用後は PASS であるべき）
--   same_*   本 migration で変えないもの（両方で PASS）
-- 出力: PASS[label] / FAIL[label]。最後に FAIL が 0 件なら "TASK INVITE SAME SPACE CHECKS PASSED"。
--   1件でもあれば例外で終了する。
-- =============================================================================
set client_min_messages = notice;

\set O1 '00000000-0000-0000-0000-00000000a001'
\set S1 '00000000-0000-0000-0000-00000000b001'
\set u_ed '00000000-0000-0000-0000-00000000c002'
\set u_nu '00000000-0000-0000-0000-00000000c004'
\set I1 '00000000-0000-0000-0000-00000000e001'
\set I2 '00000000-0000-0000-0000-00000000e002'
\set I3 '00000000-0000-0000-0000-00000000e003'
\set I4 '00000000-0000-0000-0000-00000000e004'
\set T1 '00000000-0000-0000-0000-00000000d001'
\set T2 '00000000-0000-0000-0000-00000000d002'
\set T4 '00000000-0000-0000-0000-00000000d004'
\set c_ed '{"sub":"00000000-0000-0000-0000-00000000c002","role":"authenticated"}'
\set refused 'like:err:P0001:tasks assignee invite must be in the same space%'

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

-- タスクの担当（RLS に隠されずに読む）: <assignee_id または null>/<assignee_invite_id または null>
create or replace function test.assignee(p_task uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select coalesce(assignee_id::text, 'null') || '/' || coalesce(assignee_invite_id::text, 'null')
                     from public.tasks where id = p_task), '(no row)')
$$;

-- 関数を作る migration が「既定の実行権を付けない」ので、補助関数は明示で grant する
grant execute on all functions in schema test to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 形
-- -----------------------------------------------------------------------------
\echo '== shape =='
select test.check('chg_trigger_shape', coalesce((
  select format('%s:%s', t.tgenabled::text,
                (pg_get_triggerdef(t.oid) like '%BEFORE INSERT OR UPDATE OF assignee_invite_id, space_id, org_id ON public.tasks'
                                               ' FOR EACH ROW EXECUTE FUNCTION %enforce_assignee_invite_same_space()')::text)
    from pg_trigger t
   where t.tgrelid = 'public.tasks'::regclass and t.tgname = 'trg_enforce_assignee_invite_same_space' and not t.tgisinternal
), 'missing'), 'O:true');

select test.check('chg_trigger_function_rights', coalesce((
  select format('definer=%s config=%s exec=%s/%s/%s/%s', p.prosecdef::text, array_to_string(p.proconfig, ';'),
                has_function_privilege('public', p.oid, 'execute')::text,
                has_function_privilege('anon', p.oid, 'execute')::text,
                has_function_privilege('authenticated', p.oid, 'execute')::text,
                has_function_privilege('service_role', p.oid, 'execute')::text)
    from pg_proc p where p.oid = to_regprocedure('public.enforce_assignee_invite_same_space()')
), 'missing'), 'definer=true config=search_path=public exec=false/false/false/false');

-- ほかの「同じ space だけ」のトリガーはそのまま
select test.check('same_other_same_space_triggers', (
  select string_agg(tgname, ',' order by tgname) from pg_trigger
   where tgrelid = 'public.tasks'::regclass and not tgisinternal
     and tgname in ('trg_enforce_milestone_same_space', 'trg_enforce_wiki_page_same_space')
), 'trg_enforce_milestone_same_space,trg_enforce_wiki_page_same_space');

-- -----------------------------------------------------------------------------
-- サーバー（postgres）の書き込み: 同じ space の招待は置ける・別の space / 組織の招待は止まる
-- -----------------------------------------------------------------------------
\echo '== writes as postgres =='
select test.check('same_insert_with_same_space_invite', test.flow(
  array[format('insert into public.tasks(org_id, space_id, title, status, created_by, assignee_invite_id) values (%L, %L, %L, %L, %L, %L)',
               :'O1', :'S1', 'new-same', 'todo', :'u_ed', :'I1')],
  'select count(*)::text from public.tasks where title = ''new-same'''), 'ok:1');
select test.check('chg_insert_with_other_space_invite_refused', test.flow(
  array[format('insert into public.tasks(org_id, space_id, title, status, created_by, assignee_invite_id) values (%L, %L, %L, %L, %L, %L)',
               :'O1', :'S1', 'new-other-space', 'todo', :'u_ed', :'I2')],
  'select count(*)::text from public.tasks where title = ''new-other-space'''), :'refused');
select test.check('chg_insert_with_other_org_invite_refused', test.flow(
  array[format('insert into public.tasks(org_id, space_id, title, status, created_by, assignee_invite_id) values (%L, %L, %L, %L, %L, %L)',
               :'O1', :'S1', 'new-other-org', 'todo', :'u_ed', :'I3')],
  'select count(*)::text from public.tasks where title = ''new-other-org'''), :'refused');

select test.check('same_update_to_same_space_invite', test.flow(
  array[format('update public.tasks set assignee_invite_id = %L where id = %L', :'I1', :'T1')],
  format('select test.assignee(%L)', :'T1')), 'ok:null/' || :'I1');
select test.check('chg_update_to_other_space_invite_refused', test.flow(
  array[format('update public.tasks set assignee_invite_id = %L where id = %L', :'I2', :'T1')],
  format('select test.assignee(%L)', :'T1')), :'refused');
select test.check('chg_update_to_other_org_invite_refused', test.flow(
  array[format('update public.tasks set assignee_invite_id = %L where id = %L', :'I3', :'T1')],
  format('select test.assignee(%L)', :'T1')), :'refused');

-- 担当を空にする・本人に替える・ほかの列を書き換えるのはそのまま
select test.check('same_clear_invite_assignee', test.flow(
  array[format('update public.tasks set assignee_invite_id = null where id = %L', :'T2')],
  format('select test.assignee(%L)', :'T2')), 'ok:null/null');
select test.check('same_switch_invite_to_user', test.flow(
  array[format('update public.tasks set assignee_id = %L, assignee_invite_id = null where id = %L', :'u_ed', :'T2')],
  format('select test.assignee(%L)', :'T2')), 'ok:' || :'u_ed' || '/null');
select test.check('same_update_other_columns', test.flow(
  array[format('update public.tasks set title = %L where id = %L', 't2-renamed', :'T2')],
  format('select title from public.tasks where id = %L', :'T2')), 'ok:t2-renamed');

-- 招待を消すと、外部キーで担当が空に戻る
select test.check('same_invite_delete_clears_assignee', test.flow(
  array[format('delete from public.invites where id = %L', :'I1')],
  format('select test.assignee(%L)', :'T2')), 'ok:null/null');

-- -----------------------------------------------------------------------------
-- サーバー（service role）: トリガーは service role にも効く。招待の承諾はそのまま担当を本人に移す
-- -----------------------------------------------------------------------------
\echo '== service role =='
begin;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select test.check('chg_service_role_other_space_invite_refused', test.flow(
  array[format('update public.tasks set assignee_invite_id = %L where id = %L', :'I2', :'T1')],
  format('select test.assignee(%L)', :'T1')), :'refused');
select test.check('same_service_role_same_space_invite', test.flow(
  array[format('update public.tasks set assignee_invite_id = %L where id = %L', :'I1', :'T1')],
  format('select test.assignee(%L)', :'T1')), 'ok:null/' || :'I1');
select test.check('same_accept_invite_hands_over_task', test.flow(
  array[format('select public.rpc_accept_invite(%L, %L)', 'tai-i4', :'u_nu')],
  format('select test.assignee(%L)', :'T4')), 'ok:' || :'u_nu' || '/null');
commit;

-- -----------------------------------------------------------------------------
-- 画面（社内の編集者。S1・S2 の両方の editor）: 別の space の招待は置けない
-- -----------------------------------------------------------------------------
\echo '== authenticated editor =='
begin;
set local role authenticated;
select set_config('request.jwt.claims', :'c_ed', true);
select test.check('same_editor_same_space_invite', test.flow(
  array[format('update public.tasks set assignee_invite_id = %L where id = %L', :'I1', :'T1')],
  format('select test.assignee(%L)', :'T1')), 'ok:null/' || :'I1');
select test.check('chg_editor_other_space_invite_refused', test.flow(
  array[format('update public.tasks set assignee_invite_id = %L where id = %L', :'I2', :'T1')],
  format('select test.assignee(%L)', :'T1')), :'refused');
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
    raise exception 'TASK INVITE SAME SPACE CHECKS FAILED (% failures)', v_fail;
  end if;
end $$;
select 'TASK INVITE SAME SPACE CHECKS PASSED' as result;
