-- =============================================================================
-- タスクごとのコメント数（*_task_comment_counts.sql）の挙動検証
-- 前提: run_task_comment_counts.sh が migrations → task_comment_counts_seed.sql →（GREEN なら）本 migration を
--       適用済み。人物・データは task_comment_counts_seed.sql を参照。
--
-- label:
--   chg_*   本 migration で変わるもの（適用前は FAIL・適用後は PASS）
--   same_*  変えないもの（両方で PASS）。RLS で直接読んだコメントの数が、シードどおりであること
-- 出力: PASS[label] / FAIL[label]（ハーネスが数える）。
-- 数の書き方: 'T1=7,T2=3'（タスク番号の順。0行は ''）
-- =============================================================================
set client_min_messages = notice;

\set O1  'a1000000-0000-0000-0000-000000000001'
\set O2  'a1000000-0000-0000-0000-000000000002'
\set S1  'b1000000-0000-0000-0000-000000000001'
\set S2  'b1000000-0000-0000-0000-000000000002'
\set S3  'b1000000-0000-0000-0000-000000000003'
\set u_in  'c1000000-0000-0000-0000-000000000001'
\set u_vw  'c1000000-0000-0000-0000-000000000002'
\set u_cl  'c1000000-0000-0000-0000-000000000003'
\set u_ven 'c1000000-0000-0000-0000-000000000004'
\set u_o2  'c1000000-0000-0000-0000-000000000005'

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

create or replace function test.check_like(p_label text, p_got text, p_pattern text)
returns void language plpgsql as $$
begin
  if coalesce(p_got, '') like p_pattern then
    raise notice 'PASS[%]: %', p_label, p_got;
  else
    raise notice 'FAIL[%]: got %, want like %', p_label, coalesce(p_got, 'NULL'), p_pattern;
  end if;
end $$;

-- p_role（authenticated / anon）・p_user（request.jwt.claims の sub）として、1つの値を返す SQL を実行し、postgres に戻る。
-- 成功なら値、失敗なら 'error:<SQLSTATE>:<文言>'（失敗しても外は続けられる）
create or replace function test.q_as(p_role text, p_user uuid, p_sql text)
returns text language plpgsql as $$
declare
  v text;
  v_state text;
  v_msg text;
begin
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', p_role)::text, true);
    execute format('set local role %I', p_role);
    execute p_sql into v;
    execute 'reset role';
    return coalesce(v, 'NULL');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    return 'error:' || v_state || ':' || v_msg;
  end;
end $$;

-- RPC の結果（p_args は名前付きの引数をそのまま書く。空なら引数なしで呼ぶ）
create or replace function test.rpc_as(p_role text, p_user uuid, p_args text)
returns text language sql as $$
  select test.q_as(p_role, p_user, format(
    'select coalesce(string_agg(format(''T%%s=%%s'', ltrim(right(r.task_id::text, 4), ''0''), r.comment_count), '','' order by r.task_id), '''')'
    ' from public.rpc_task_comment_counts(%s) r', p_args));
$$;

-- RLS を通して、その space のコメントを直接数えた結果（本 migration と関係なく、見える範囲の正解）
create or replace function test.direct_as(p_user uuid, p_space uuid)
returns text language sql as $$
  select test.q_as('authenticated', p_user, format(
    'select coalesce(string_agg(format(''T%%s=%%s'', ltrim(right(x.task_id::text, 4), ''0''), x.n), '','' order by x.task_id), '''')'
    ' from (select c.task_id, count(*) as n from public.task_comments c'
    '        where c.deleted_at is null and c.space_id = %L group by c.task_id) x', p_space));
$$;

-- -----------------------------------------------------------------------------
-- 見える範囲の正解（RLS で直接読む。本 migration では変えない）
-- -----------------------------------------------------------------------------
select test.check('same_rls_internal_sees_all_visibilities', test.direct_as(:'u_in', :'S1'), 'T1=7,T2=3,T3=3,T8=3');
select test.check('same_rls_viewer_sees_all_visibilities',   test.direct_as(:'u_vw', :'S1'), 'T1=7,T2=3,T3=3,T8=3');
select test.check('same_rls_client_sees_client_only',        test.direct_as(:'u_cl', :'S1'), 'T1=3,T3=1,T8=1');
select test.check('same_rls_vendor_sees_vendor_only',        test.direct_as(:'u_ven', :'S1'), 'T1=1,T8=1');
select test.check('same_rls_other_org_sees_nothing',         test.direct_as(:'u_o2', :'S1'), '');

-- -----------------------------------------------------------------------------
-- プロジェクトのタスク一覧の形（p_space_id）: RLS の見える範囲のとおりに数える
-- -----------------------------------------------------------------------------
-- 社内（編集者・閲覧者）は internal / client / vendor / agency_only を全部数える。消したコメントは数えない
select test.check('chg_internal_counts_all_visibilities',
  test.rpc_as('authenticated', :'u_in', format('p_space_id => %L', :'S1')), 'T1=7,T2=3,T3=3,T8=3');
select test.check('chg_viewer_counts_all_visibilities',
  test.rpc_as('authenticated', :'u_vw', format('p_space_id => %L', :'S1')), 'T1=7,T2=3,T3=3,T8=3');
-- 相手先は client のコメントだけ。社内だけのタスク（T2）は出ない
select test.check('chg_client_counts_client_comments_only',
  test.rpc_as('authenticated', :'u_cl', format('p_space_id => %L', :'S1')), 'T1=3,T3=1,T8=1');
-- vendor は vendor のコメントだけ。社内だけのタスク（T2）・相手先の番のタスク（T3）は出ない
select test.check('chg_vendor_counts_vendor_comments_only',
  test.rpc_as('authenticated', :'u_ven', format('p_space_id => %L', :'S1')), 'T1=1,T8=1');
-- 消したコメントは数えない。コメントが無いタスク（T4）・全部消したタスク（T5）は行ごと出ない
select test.check('chg_deleted_and_empty_tasks_not_returned',
  test.q_as('authenticated', :'u_in', format(
    'select format(''%%s|%%s'', count(*) filter (where task_id in (%L, %L)), max(comment_count) filter (where task_id = %L))'
    ' from public.rpc_task_comment_counts(p_space_id => %L)',
    'd1000000-0000-0000-0000-000000000004', 'd1000000-0000-0000-0000-000000000005',
    'd1000000-0000-0000-0000-000000000001', :'S1')),
  '0|7');
-- 返す列の型（一覧側は数として受け取る）
select test.check('chg_returns_integer_count',
  test.q_as('authenticated', :'u_in', format(
    'select pg_typeof(comment_count)::text from public.rpc_task_comment_counts(p_space_id => %L) limit 1', :'S1')),
  'integer');

-- 別の space・別の組織のコメントは混ざらない
select test.check('chg_other_space_not_mixed',
  test.rpc_as('authenticated', :'u_in', format('p_space_id => %L', :'S2')), 'T6=3');
select test.check('chg_other_org_space_counts_own_only',
  test.rpc_as('authenticated', :'u_in', format('p_space_id => %L', :'S3')), 'T7=4');
select test.check('chg_other_org_member_gets_nothing',
  test.rpc_as('authenticated', :'u_o2', format('p_space_id => %L', :'S1')), '');
select test.check('chg_client_not_member_of_space_gets_nothing',
  test.rpc_as('authenticated', :'u_cl', format('p_space_id => %L', :'S2')), '');
-- p_org_id を添えたら、その組織の分だけ
select test.check('chg_space_with_matching_org',
  test.rpc_as('authenticated', :'u_in', format('p_space_id => %L, p_org_id => %L', :'S1', :'O1')), 'T1=7,T2=3,T3=3,T8=3');
select test.check('chg_space_with_other_org_is_empty',
  test.rpc_as('authenticated', :'u_in', format('p_space_id => %L, p_org_id => %L', :'S1', :'O2')), '');

-- -----------------------------------------------------------------------------
-- マイタスクの形（p_assignee_id）: 担当のタスクだけ・見えるものだけ
-- -----------------------------------------------------------------------------
-- 自分が担当のタスク（組織・space をまたぐ）。コメントが無い T4・全部消した T5 は出ない
select test.check('chg_assignee_mine_across_orgs',
  test.rpc_as('authenticated', :'u_in', format('p_assignee_id => %L', :'u_in')), 'T1=7,T6=3,T7=4');
-- p_org_id を添えたら、その組織の分だけ（マイタスクで組織を選んでいるとき）
select test.check('chg_assignee_mine_with_org',
  test.rpc_as('authenticated', :'u_in', format('p_assignee_id => %L, p_org_id => %L', :'u_in', :'O1')), 'T1=7,T6=3');
select test.check('chg_assignee_with_space',
  test.rpc_as('authenticated', :'u_in', format('p_space_id => %L, p_assignee_id => %L', :'S1', :'u_in')), 'T1=7');
-- 見えない組織のタスク（T7）は、担当者で聞いても出ない
select test.check('chg_assignee_other_org_hidden',
  test.rpc_as('authenticated', :'u_vw', format('p_assignee_id => %L', :'u_in')), 'T1=7,T6=3');
-- 相手先が担当でも、社内だけのタスク（T2）は出ない
select test.check('chg_assignee_client_hidden_task',
  test.rpc_as('authenticated', :'u_cl', format('p_assignee_id => %L', :'u_cl')), '');
-- vendor が担当でも、相手先の番のタスク（T3）は出ない。数えるのは vendor のコメントだけ
select test.check('chg_assignee_vendor_visible_only',
  test.rpc_as('authenticated', :'u_ven', format('p_assignee_id => %L', :'u_ven')), 'T8=1');

-- -----------------------------------------------------------------------------
-- 全件は数えさせない: p_space_id と p_assignee_id が両方 null なら0行
-- -----------------------------------------------------------------------------
select test.check('chg_no_filter_returns_nothing',
  test.rpc_as('authenticated', :'u_in', ''), '');
select test.check('chg_explicit_nulls_return_nothing',
  test.rpc_as('authenticated', :'u_in', 'p_space_id => null, p_assignee_id => null, p_org_id => null'), '');
select test.check('chg_org_only_returns_nothing',
  test.rpc_as('authenticated', :'u_in', format('p_org_id => %L', :'O1')), '');

-- -----------------------------------------------------------------------------
-- 実行権と関数の形
-- -----------------------------------------------------------------------------
select test.check_like('chg_anon_cannot_execute',
  test.rpc_as('anon', null, format('p_space_id => %L', :'S1')), 'error:42501:%');
select test.check('chg_execute_privileges',
  (select format('anon=%s|authenticated=%s|public=%s',
     coalesce(has_function_privilege('anon', to_regprocedure('public.rpc_task_comment_counts(uuid,uuid,uuid)'), 'execute')::text, 'none'),
     coalesce(has_function_privilege('authenticated', to_regprocedure('public.rpc_task_comment_counts(uuid,uuid,uuid)'), 'execute')::text, 'none'),
     coalesce((select (count(*) > 0)::text from pg_proc p, aclexplode(p.proacl) a
                where p.oid = to_regprocedure('public.rpc_task_comment_counts(uuid,uuid,uuid)') and a.grantee = 0
               having bool_or(true)), 'false'))),
  'anon=false|authenticated=true|public=false');
-- 呼んだ人の権限で読む（SECURITY INVOKER）ので RLS がそのまま効く。読むだけ（STABLE）
select test.check('chg_function_shape',
  (select format('definer=%s|volatile=%s|args=%s|result=%s',
     p.prosecdef::text, p.provolatile, pg_get_function_arguments(p.oid), pg_get_function_result(p.oid))
     from pg_proc p where p.oid = to_regprocedure('public.rpc_task_comment_counts(uuid,uuid,uuid)')),
  'definer=false|volatile=s|args=p_space_id uuid DEFAULT NULL::uuid, p_assignee_id uuid DEFAULT NULL::uuid, p_org_id uuid DEFAULT NULL::uuid|result=TABLE(task_id uuid, comment_count integer)');
