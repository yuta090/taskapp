-- =============================================================================
-- 見せ方を狭めたときにコメントのお知らせを消す（*_comment_notify_retract_on_narrow.sql）の挙動検証
-- 前提: run_comment_notify_retract_on_narrow.sh が migrations（20260915105122_task_comment_notify.sql まで）→
--       comment_notify_retract_on_narrow_seed.sql →（GREEN なら）本 migration を2回適用済み。
--       人物・データは comment_notify_retract_on_narrow_seed.sql を参照。
--
-- label:
--   chg_*   本 migration で変わるもの（適用前は FAIL・適用後は PASS）
--   same_*  変えないもの（両方で PASS）
-- 出力: PASS[label] / FAIL[label]（ハーネスが数える）。
--   書き換える確認は1つずつ begin … rollback で包み、互いに影響させない。
--   書き込みは test.run が行い、失敗しても文字列で返す。
--   トリガー関数が呼ばれた回数は、関数の統計（track_functions）で数える。統計はトランザクションを越えて持ち越すことがあるので、
--   区切りの頭で数えた値との差を見る（関数が無ければ 0）。
-- =============================================================================
set client_min_messages = notice;

\set O1 'a0000000-0000-0000-0000-000000000001'
\set S1 'b0000000-0000-0000-0000-000000000001'
\set u_au 'c0000000-0000-0000-0000-000000000001'
\set u_as 'c0000000-0000-0000-0000-000000000002'
\set u_nm 'c0000000-0000-0000-0000-000000000003'
\set u_cl 'c0000000-0000-0000-0000-000000000004'
\set u_vd 'c0000000-0000-0000-0000-000000000005'
\set T1 'd0000000-0000-0000-0000-000000000001'
\set T2 'd0000000-0000-0000-0000-000000000002'
\set T3 'd0000000-0000-0000-0000-000000000003'
\set T4 'd0000000-0000-0000-0000-000000000004'
\set K1 'f0000000-0000-0000-0000-000000000001'
\set K2 'f0000000-0000-0000-0000-000000000002'
\set K3 'f0000000-0000-0000-0000-000000000003'
\set K4 'f0000000-0000-0000-0000-000000000004'
\set K5 'f0000000-0000-0000-0000-000000000005'
\set K6 'f0000000-0000-0000-0000-000000000006'
\set K7 'f0000000-0000-0000-0000-000000000007'
-- 本 migration のトリガー関数
\set FN_C 'public.app_task_comment_retract_on_visibility_change()'
\set FN_T 'public.app_task_comment_retract_on_task_scope_change()'
-- シードのお知らせ（「宛先:経路:種類」を宛先・経路・種類の順に）
\set SEED_K1 'as:in_app:comment_added,cl:email:comment_added,cl:in_app:mention,nm:in_app:mention,vd:in_app:ball_passed'
\set SEED_K2 'as:in_app:comment_added,vd:in_app:mention'
\set SEED_K3 'as:in_app:comment_added'
\set SEED_K4 'as:in_app:comment_added,cl:in_app:mention'
\set SEED_K5 'as:in_app:comment_added,vd:in_app:mention'
\set SEED_K6 'as:in_app:comment_added'
\set SEED_K7 'as:in_app:comment_added'
-- K1 から、読めなくなった相手先の行（cl の mention）だけを消したもの
\set K1_WITHOUT_CL 'as:in_app:comment_added,cl:email:comment_added,nm:in_app:mention,vd:in_app:ball_passed'

-- -----------------------------------------------------------------------------
-- 検証ヘルパ
-- -----------------------------------------------------------------------------
create schema if not exists test;

create or replace function test.check(p_label text, p_got text, p_want text)
returns void language plpgsql as $$
begin
  if p_got is not distinct from p_want then
    raise notice 'PASS[%]: %', p_label, p_got;
  else
    raise notice 'FAIL[%]: got %, want %', p_label, coalesce(p_got, 'NULL'), p_want;
  end if;
end $$;

create table test.people (id uuid primary key, name text not null);
insert into test.people (id, name) values
  (:'u_au', 'au'), (:'u_as', 'as'), (:'u_nm', 'nm'), (:'u_cl', 'cl'), (:'u_vd', 'vd');

create table test.comment_names (id uuid primary key, name text not null);
insert into test.comment_names (id, name)
select format('f0000000-0000-0000-0000-00000000000%s', i)::uuid, format('K%s', i)
  from generate_series(1, 7) as i;

-- p_role（authenticated / service_role）として SQL を1つ実行し、postgres に戻る。
-- 成功なら 'ok'、失敗なら 'error:<SQLSTATE>:<文言>'（失敗しても外のトランザクションは続けられる）
create or replace function test.run(p_user uuid, p_role text, p_sql text)
returns text language plpgsql as $$
declare
  v_state text;
  v_msg text;
begin
  begin
    if p_role = 'authenticated' then
      perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
    else
      perform set_config('request.jwt.claims', json_build_object('role', p_role)::text, true);
    end if;
    execute format('set local role %I', p_role);
    execute p_sql;
    execute 'reset role';
    return 'ok';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    return 'error:' || v_state || ':' || v_msg;
  end;
end $$;

-- お知らせを1行入れる（postgres で。そのコメントの組織・案件で、dedupe_key = 'task_comment:<コメントの id>'）
create or replace function test.put_notice(p_comment uuid, p_user uuid, p_type text, p_channel text default 'in_app')
returns void language sql as $$
  insert into public.notifications (org_id, space_id, to_user_id, channel, type, dedupe_key, payload)
  select c.org_id, c.space_id, p_user, p_channel, p_type, 'task_comment:' || c.id::text,
         jsonb_build_object('comment_id', c.id, 'message', c.body)
    from public.task_comments c
   where c.id = p_comment;
$$;

-- dedupe_key = 'task_comment:<コメントの id>' のお知らせ（「宛先:経路:種類」を宛先・経路・種類の順に。無ければ空文字）
create or replace function test.notices_all(p_comment uuid)
returns text language sql as $$
  select coalesce(string_agg(coalesce(p.name, n.to_user_id::text) || ':' || n.channel || ':' || n.type, ','
                             order by coalesce(p.name, n.to_user_id::text) collate "C", n.channel collate "C",
                                      n.type collate "C"), '')
    from public.notifications n
    left join test.people p on p.id = n.to_user_id
   where n.dedupe_key = 'task_comment:' || p_comment::text;
$$;

-- 複数のコメントのお知らせを、渡した順に「|」でつなぐ
create or replace function test.notices_of(p_ids uuid[])
returns text language sql as $$
  select string_agg(test.notices_all(x.id), '|' order by x.ord)
    from unnest(p_ids) with ordinality as x(id, ord);
$$;

-- あるコメントについて、ある人あての受信トレイのコメントのお知らせ（in_app・comment_added / mention）の件数
create or replace function test.count_live(p_comment uuid, p_user uuid)
returns text language sql as $$
  select count(*)::text
    from public.notifications n
   where n.to_user_id = p_user
     and n.channel = 'in_app'
     and n.type in ('comment_added', 'mention')
     and n.dedupe_key = 'task_comment:' || p_comment::text;
$$;

-- その関数がこれまでに呼ばれた回数（関数の統計。関数が無ければ 0。先に track_functions を設定しておく）
create or replace function test.calls(p_fn text)
returns text language sql as $$
  select coalesce(pg_stat_get_xact_function_calls(to_regprocedure(p_fn)), 0)::text;
$$;

-- p_base（区切りの頭で test.calls が返した値）から増えた回数
create or replace function test.calls_since(p_fn text, p_base text)
returns text language sql as $$
  select (coalesce(pg_stat_get_xact_function_calls(to_regprocedure(p_fn)), 0) - p_base::bigint)::text;
$$;

-- 受信トレイに残っているコメントのお知らせ（in_app・comment_added / mention）のうち、宛先の人が
-- RLS を通して（authenticated で）そのコメントを読めないもの。「宛先:コメント」をカンマ区切り。無ければ空文字。
-- 補助関数ではなく、本物の読み取りのポリシーで確かめる
create or replace function test.leaks()
returns text language plpgsql as $$
declare
  r record;
  v_n int;
  v text := '';
begin
  for r in
    select n.to_user_id, substr(n.dedupe_key, 14)::uuid as comment_id,
           coalesce(p.name, n.to_user_id::text) as who, coalesce(c.name, substr(n.dedupe_key, 14)) as what
      from public.notifications n
      left join test.people p on p.id = n.to_user_id
      left join test.comment_names c on c.id::text = substr(n.dedupe_key, 14)
     where n.channel = 'in_app'
       and n.type in ('comment_added', 'mention')
       and n.dedupe_key like 'task_comment:%'
     order by coalesce(p.name, n.to_user_id::text) collate "C", coalesce(c.name, substr(n.dedupe_key, 14)) collate "C"
  loop
    perform set_config('request.jwt.claims', json_build_object('sub', r.to_user_id, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    execute 'select count(*) from public.task_comments c where c.id = $1' into v_n using r.comment_id;
    execute 'reset role';
    if v_n = 0 then
      v := v || case when v = '' then '' else ',' end || r.who || ':' || r.what;
    end if;
  end loop;
  return v;
end $$;

-- -----------------------------------------------------------------------------
-- シードの状態（トリガーが作ったお知らせ・足した行）。はじめは漏れが無い
-- -----------------------------------------------------------------------------
select test.check('same_seed_notices',
  test.notices_of(array[:'K1', :'K2', :'K3', :'K4', :'K5', :'K6', :'K7']::uuid[]),
  concat_ws('|', :'SEED_K1', :'SEED_K2', :'SEED_K3', :'SEED_K4', :'SEED_K5', :'SEED_K6', :'SEED_K7'));
select test.check('same_seed_cl_mention_read',
  (select (read_at is not null)::text from public.notifications
    where to_user_id = :'u_cl' and channel = 'in_app' and dedupe_key = 'task_comment:' || :'K1'), 'true');
select test.check('same_seed_no_leaks', test.leaks(), '');

-- -----------------------------------------------------------------------------
-- 形: トリガー（行ごと・AFTER UPDATE OF・値が変わったときだけ）・関数・実行権。今あるトリガーはそのまま
-- -----------------------------------------------------------------------------
select test.check('chg_visibility_trigger_form',
  (select format('%s|%s|%s|%s', count(*), string_agg(t.tgenabled::text, ','),
                 bool_and(t.tgfoid = to_regprocedure(:'FN_C'))::text,
                 string_agg(regexp_replace(pg_get_triggerdef(t.oid), ' EXECUTE FUNCTION .*$', ''), ';'))
     from pg_trigger t
    where t.tgrelid = 'public.task_comments'::regclass
      and not t.tgisinternal
      and t.tgname = 'task_comments_retract_on_visibility_change'),
  '1|O|true|CREATE TRIGGER task_comments_retract_on_visibility_change AFTER UPDATE OF visibility ON public.task_comments '
  'FOR EACH ROW WHEN ((old.visibility IS DISTINCT FROM new.visibility))');

select test.check('chg_task_trigger_form',
  (select format('%s|%s|%s|%s', count(*), string_agg(t.tgenabled::text, ','),
                 bool_and(t.tgfoid = to_regprocedure(:'FN_T'))::text,
                 string_agg(regexp_replace(pg_get_triggerdef(t.oid), ' EXECUTE FUNCTION .*$', ''), ';'))
     from pg_trigger t
    where t.tgrelid = 'public.tasks'::regclass
      and not t.tgisinternal
      and t.tgname = 'tasks_retract_comment_notice_on_scope_change'),
  '1|O|true|CREATE TRIGGER tasks_retract_comment_notice_on_scope_change AFTER UPDATE OF client_scope, ball ON public.tasks '
  'FOR EACH ROW WHEN (((old.client_scope IS DISTINCT FROM new.client_scope) OR (old.ball IS DISTINCT FROM new.ball)))');

select test.check('chg_functions_definer_search_path',
  (select string_agg(format('%s:%s:%s', p.proname, p.prosecdef::text, array_to_string(p.proconfig, ';')), ','
                     order by p.proname)
     from pg_proc p
    where p.oid in (to_regprocedure(:'FN_C'), to_regprocedure(:'FN_T'))),
  'app_task_comment_retract_on_task_scope_change:true:search_path=public,'
  'app_task_comment_retract_on_visibility_change:true:search_path=public');

-- トリガー関数は利用者が直接呼べない（PUBLIC・anon・authenticated）
select test.check('chg_functions_not_callable',
  (select string_agg(format('%s|%s|%s', has_function_privilege('public', f::oid, 'execute')::text,
                            has_function_privilege('anon', f::oid, 'execute')::text,
                            has_function_privilege('authenticated', f::oid, 'execute')::text), ';' order by f::text)
     from unnest(array[to_regprocedure(:'FN_C'), to_regprocedure(:'FN_T')]) as f
    where f is not null),
  'false|false|false;false|false|false');

select test.check('same_existing_comment_triggers_kept',
  (select string_agg(t.tgname || ':' || t.tgenabled::text, ',' order by t.tgname)
     from pg_trigger t
    where t.tgrelid = 'public.task_comments'::regclass
      and not t.tgisinternal
      and t.tgfoid in (to_regprocedure('public.app_task_comment_notify()'),
                       to_regprocedure('public.app_task_comment_retract_notice()'))),
  'task_comments_notify:O,task_comments_retract_notice:O');


-- =============================================================================
-- コメントの visibility を変えたとき
-- =============================================================================

-- 相手先向け → 社内のみ（書いた本人が画面の権限で変える）: 相手先（cl）の行だけ消える。
--   社内の人（as・nm）の行は残る。既読でも消す。メールの行・ball_passed の行・ほかのコメントのお知らせは残す
begin;
select test.check('same_visibility_narrow_saved',
  test.run(:'u_au', 'authenticated', format('update public.task_comments set visibility = %L where id = %L', 'internal', :'K1')), 'ok');
select test.check('same_visibility_narrow_value', (select visibility from public.task_comments where id = :'K1'), 'internal');
select test.check('chg_visibility_client_to_internal_retracts_client', test.notices_all(:'K1'), :'K1_WITHOUT_CL');
select test.check('same_visibility_narrow_keeps_other_comments',
  test.notices_of(array[:'K2', :'K3', :'K4', :'K5', :'K6', :'K7']::uuid[]),
  concat_ws('|', :'SEED_K2', :'SEED_K3', :'SEED_K4', :'SEED_K5', :'SEED_K6', :'SEED_K7'));
select test.check('chg_visibility_narrow_no_leaks', test.leaks(), '');
rollback;

-- vendor 向け → 相手先向け（ポータルのサーバーと同じ service role で変える）: vendor（vd）の行が消える。
--   相手先には作らない（広がった側に作り直しはしない）
begin;
select test.check('same_visibility_lateral_saved_service_role',
  test.run(null, 'service_role', format('update public.task_comments set visibility = %L where id = %L', 'client', :'K2')), 'ok');
select test.check('chg_visibility_vendor_to_client_retracts_vendor', test.notices_all(:'K2'), 'as:in_app:comment_added');
select test.check('same_visibility_change_not_recreated', test.count_live(:'K2', :'u_cl'), '0');
rollback;

-- 相手先向け → 代理店のみ（agency_only）: 相手先の行が消える
begin;
select test.check('same_visibility_agency_only_saved',
  test.run(:'u_au', 'authenticated', format('update public.task_comments set visibility = %L where id = %L', 'agency_only', :'K4')), 'ok');
select test.check('chg_visibility_to_agency_only_retracts_client', test.notices_all(:'K4'), 'as:in_app:comment_added');
rollback;

-- 社内のみ → 相手先向け（広げる）: 何も消えず、作り直しもしない
begin;
select test.check('same_visibility_widen_saved',
  test.run(:'u_au', 'authenticated', format('update public.task_comments set visibility = %L where id = %L', 'client', :'K3')), 'ok');
select test.check('same_visibility_widen_changes_nothing',
  test.notices_of(array[:'K1', :'K2', :'K3']::uuid[]), concat_ws('|', :'SEED_K1', :'SEED_K2', :'SEED_K3'));
rollback;

-- visibility が変わらない更新ではトリガー関数を呼ばない（本文だけ・同じ値を書く）。変わったら1回だけ呼ぶ
--   vd あての行を足しておく（vd は相手先向けの K4 を読めないので、判定が動けば消える）
begin;
set local track_functions = 'all';
select test.calls(:'FN_C') as base_c \gset
select test.put_notice(:'K4', :'u_vd', 'comment_added');
select test.check('same_body_edit_saved',
  test.run(:'u_au', 'authenticated', format('update public.task_comments set body = %L where id = %L', '本文だけ直す', :'K4')), 'ok');
select test.check('same_same_visibility_write_saved',
  test.run(:'u_au', 'authenticated',
           format('update public.task_comments set visibility = %L, body = %L where id = %L', 'client', '同じ公開範囲を書く', :'K4')), 'ok');
select test.check('same_unchanged_visibility_not_called', test.calls_since(:'FN_C', :'base_c'), '0');
select test.check('same_unchanged_visibility_keeps_notices', test.notices_all(:'K4'),
  'as:in_app:comment_added,cl:in_app:mention,vd:in_app:comment_added');
select test.check('same_visibility_to_vendor_saved',
  test.run(:'u_au', 'authenticated', format('update public.task_comments set visibility = %L where id = %L', 'vendor', :'K4')), 'ok');
select test.check('chg_visibility_change_called_once', test.calls_since(:'FN_C', :'base_c'), '1');
select test.check('chg_visibility_to_vendor_retracts_client_keeps_vendor', test.notices_all(:'K4'),
  'as:in_app:comment_added,vd:in_app:comment_added');
rollback;


-- =============================================================================
-- タスクの見せ方（client_scope）・ボール（ball）を変えたとき
-- =============================================================================

-- 相手先に見える → 社内のみ（画面の権限で変える）: T1 のコメントの相手先・vendor あての行だけ消える。
--   社内の人の行・メールの行・ball_passed の行は残る。別のタスク（T2・T4）のコメントのお知らせは残る
begin;
select test.check('same_scope_narrow_saved',
  test.run(:'u_au', 'authenticated', format('update public.tasks set client_scope = %L where id = %L', 'internal', :'T1')), 'ok');
select test.check('chg_scope_narrow_retracts_external',
  test.notices_of(array[:'K1', :'K2', :'K3']::uuid[]),
  concat_ws('|', :'K1_WITHOUT_CL', 'as:in_app:comment_added', :'SEED_K3'));
select test.check('same_scope_narrow_keeps_other_tasks',
  test.notices_of(array[:'K4', :'K5', :'K6', :'K7']::uuid[]),
  concat_ws('|', :'SEED_K4', :'SEED_K5', :'SEED_K6', :'SEED_K7'));
select test.check('chg_scope_narrow_no_leaks', test.leaks(), '');
rollback;

-- service role で変えても同じ（T2 のコメントの相手先・vendor の行が消え、T1 のは残る）
begin;
select test.check('same_scope_narrow_saved_service_role',
  test.run(null, 'service_role', format('update public.tasks set client_scope = %L where id = %L', 'internal', :'T2')), 'ok');
select test.check('chg_scope_narrow_service_role_retracts_external',
  test.notices_of(array[:'K4', :'K5']::uuid[]), 'as:in_app:comment_added|as:in_app:comment_added');
select test.check('same_scope_narrow_service_role_keeps_other_task',
  test.notices_of(array[:'K1', :'K2', :'K3']::uuid[]), concat_ws('|', :'SEED_K1', :'SEED_K2', :'SEED_K3'));
rollback;

-- ボールを相手先に渡す（rpc_pass_ball・画面と同じ経路）: vendor（vd）の行が消える（ボールが相手先のタスクは vendor に見えない）。
--   相手先・社内の人の行は残る。別のタスクの vendor の行は残る
begin;
select test.check('same_pass_ball_to_client_saved',
  test.run(:'u_au', 'authenticated',
           format('select public.rpc_pass_ball(%L::uuid, %L, array[%L]::uuid[])', :'T1', 'client', :'u_cl')), 'ok');
select test.check('same_pass_ball_to_client_value',
  (select ball || '|' || client_scope from public.tasks where id = :'T1'), 'client|deliverable');
select test.check('chg_ball_to_client_retracts_vendor',
  test.notices_of(array[:'K1', :'K2', :'K3']::uuid[]),
  concat_ws('|', :'SEED_K1', 'as:in_app:comment_added', :'SEED_K3'));
select test.check('same_ball_to_client_keeps_other_task', test.notices_all(:'K5'), :'SEED_K5');
select test.check('chg_ball_to_client_no_leaks', test.leaks(), '');
rollback;

-- ボールを vendor に渡す: vendor は読めるままなので何も消えない
begin;
select test.check('same_ball_to_vendor_saved',
  test.run(:'u_au', 'authenticated', format('update public.tasks set ball = %L where id = %L', 'vendor', :'T1')), 'ok');
select test.check('same_ball_to_vendor_changes_nothing',
  test.notices_of(array[:'K1', :'K2', :'K3']::uuid[]), concat_ws('|', :'SEED_K1', :'SEED_K2', :'SEED_K3'));
rollback;

-- 社内のみ → 相手先に見える（広げる）: 何も消えず、作り直しもしない（K6 の相手先あては作らない）
begin;
select test.check('same_scope_widen_saved',
  test.run(:'u_au', 'authenticated', format('update public.tasks set client_scope = %L where id = %L', 'deliverable', :'T4')), 'ok');
select test.check('same_scope_widen_changes_nothing',
  test.notices_of(array[:'K6', :'K7']::uuid[]), concat_ws('|', :'SEED_K6', :'SEED_K7'));
select test.check('same_scope_widen_not_recreated', test.count_live(:'K6', :'u_cl'), '0');
rollback;

-- 狭めてから戻しても、消えた行は作り直さない
begin;
select test.run(:'u_au', 'authenticated', format('update public.tasks set client_scope = %L where id = %L', 'internal', :'T1'));
select test.check('same_scope_back_to_deliverable_saved',
  test.run(:'u_au', 'authenticated', format('update public.tasks set client_scope = %L where id = %L', 'deliverable', :'T1')), 'ok');
select test.check('chg_scope_narrow_then_widen_not_recreated',
  test.notices_of(array[:'K1', :'K2']::uuid[]), concat_ws('|', :'K1_WITHOUT_CL', 'as:in_app:comment_added'));
rollback;

-- 関係ない列の更新（タイトル・状態）と、見せ方・ボールを同じ値で書く更新ではトリガー関数を呼ばない。
--   ボールが変わったら1回だけ呼び、読めない人の行を消す。
--   cl あての行を足しておく（T4 は社内のみなので cl は K6 を読めない。判定が動けば消える）
begin;
set local track_functions = 'all';
select test.calls(:'FN_T') as base_t \gset
select test.put_notice(:'K6', :'u_cl', 'comment_added');
select test.check('same_task_title_update_saved',
  test.run(:'u_au', 'authenticated', format('update public.tasks set title = %L where id = %L', '名前を変えた', :'T4')), 'ok');
select test.check('same_task_status_update_saved',
  test.run(:'u_au', 'authenticated', format('update public.tasks set status = %L where id = %L', 'todo', :'T4')), 'ok');
select test.check('same_task_same_scope_write_saved',
  test.run(:'u_au', 'authenticated',
           format('update public.tasks set client_scope = %L, ball = %L, title = %L where id = %L', 'internal', 'internal', '同じ値を書く', :'T4')), 'ok');
select test.check('same_task_unrelated_updates_not_called', test.calls_since(:'FN_T', :'base_t'), '0');
select test.check('same_task_unrelated_updates_keep_notices', test.notices_all(:'K6'),
  'as:in_app:comment_added,cl:in_app:comment_added');
select test.check('same_task_ball_change_saved',
  test.run(:'u_au', 'authenticated', format('update public.tasks set ball = %L where id = %L', 'agency', :'T4')), 'ok');
select test.check('chg_task_ball_change_called_once', test.calls_since(:'FN_T', :'base_t'), '1');
select test.check('chg_task_ball_change_rejudges', test.notices_all(:'K6'), 'as:in_app:comment_added');
rollback;

-- コメントの無いタスク（T3）のボールを変えても、関数が1回呼ばれるだけで何も起きない
begin;
set local track_functions = 'all';
select test.calls(:'FN_T') as base_t3 \gset
select test.check('same_no_comment_task_ball_change_saved',
  test.run(:'u_au', 'authenticated', format('update public.tasks set ball = %L where id = %L', 'agency', :'T3')), 'ok');
select test.check('chg_no_comment_task_called_once', test.calls_since(:'FN_T', :'base_t3'), '1');
select test.check('same_no_comment_task_changes_nothing',
  test.notices_of(array[:'K1', :'K2', :'K3', :'K4', :'K5', :'K6', :'K7']::uuid[]),
  concat_ws('|', :'SEED_K1', :'SEED_K2', :'SEED_K3', :'SEED_K4', :'SEED_K5', :'SEED_K6', :'SEED_K7'));
rollback;


-- =============================================================================
-- お知らせを消すのに失敗しても、元の更新（コメント・タスク）は止めない（警告を出し、お知らせは1行も消さない）。
--   そのあとも同じトランザクションで消せる
-- =============================================================================
begin;
create function test.block_notice_delete() returns trigger language plpgsql as $f$
begin
  raise exception 'test: お知らせを消せない';
end $f$;
create trigger test_block_notice_delete before delete on public.notifications
  for each row execute function test.block_notice_delete();
select test.check('same_visibility_saved_when_retract_fails',
  test.run(:'u_au', 'authenticated', format('update public.task_comments set visibility = %L where id = %L', 'internal', :'K1')), 'ok');
select test.check('same_visibility_value_when_retract_fails',
  (select visibility from public.task_comments where id = :'K1'), 'internal');
select test.check('same_no_partial_retract_when_visibility_retract_fails', test.notices_all(:'K1'), :'SEED_K1');
select test.check('same_scope_saved_when_retract_fails',
  test.run(:'u_au', 'authenticated', format('update public.tasks set client_scope = %L where id = %L', 'internal', :'T2')), 'ok');
select test.check('same_scope_value_when_retract_fails',
  (select client_scope from public.tasks where id = :'T2'), 'internal');
select test.check('same_no_partial_retract_when_scope_retract_fails',
  test.notices_of(array[:'K4', :'K5']::uuid[]), concat_ws('|', :'SEED_K4', :'SEED_K5'));
drop trigger test_block_notice_delete on public.notifications;
select test.run(:'u_au', 'authenticated', format('update public.tasks set ball = %L where id = %L', 'agency', :'T2'));
select test.check('chg_retract_works_after_failure',
  test.notices_of(array[:'K4', :'K5']::uuid[]), 'as:in_app:comment_added|as:in_app:comment_added');
rollback;
