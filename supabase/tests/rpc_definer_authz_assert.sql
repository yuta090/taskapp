-- =============================================================================
-- 関数の実行権と呼んだ人の確認（*_rpc_definer_authz.sql）の挙動検証
-- 前提: run_rpc_definer_authz.sh が _local_bootstrap → Supabase の権限の代役 → migrations を verbatim 適用済み
--   （RED=1 のときは本 migration だけ適用しない）。
--   節 A・節 C の本文が変わらないことは、ハーネスが適用前後のスキーマの指紋で確かめる（scope_*）。
--
-- データ: 組織 O1（space S1・S1 の API キー K1・S1 のタスク T1）・組織 O2。
-- 人物（set role ＋ request.jwt.claims の sub で切り替える）:
--   own    O1 owner
--   adm    O1 admin（org_memberships の役割の制約に 'admin' が無いので、この人の呼び出しだけは
--          制約を広げたトランザクションの中で行い、巻き戻す）
--   mem    O1 member
--   ed     O1 member・S1 editor（社内の編集者）
--   rcv    O1 member（ボールを受け取る人）
--   cli    O1 client（相手先）
--   o2     O2 owner（O1 には所属しない）
--   nouid  authenticated だがログイン中の利用者が無い
--   anon   未ログイン（公開キー）
--   svc    service_role（サーバー）
--
-- label:
--   chg_*    本 migration で結果が変わるもの（適用前は FAIL・適用後は PASS であるべき）
--   same_*   適用前後で結果が同じであるべきもの（両方で PASS）
-- 関数を足したら「実行権の表」に行を足す。節 B と同じ形（本文に確認を足す）の関数なら、人物ごとの呼び出しも足す。
-- 出力: PASS[label] / FAIL[label]。最後に FAIL が 0 件なら "RPC DEFINER AUTHZ CHECKS PASSED"。
--   1件でもあれば例外で終了する。
-- =============================================================================
set client_min_messages = notice;

\set O1 '00000000-0000-0000-0000-00000000a001'
\set O2 '00000000-0000-0000-0000-00000000a002'
\set S1 '00000000-0000-0000-0000-00000000b001'
\set K1 '00000000-0000-0000-0000-00000000f001'
\set T1 '00000000-0000-0000-0000-00000000d001'
\set u_own '00000000-0000-0000-0000-00000000c001'
\set u_adm '00000000-0000-0000-0000-00000000c002'
\set u_mem '00000000-0000-0000-0000-00000000c003'
\set u_cli '00000000-0000-0000-0000-00000000c004'
\set u_o2  '00000000-0000-0000-0000-00000000c005'
\set u_ed  '00000000-0000-0000-0000-00000000c006'
\set u_rcv '00000000-0000-0000-0000-00000000c007'

\set c_own '{"sub":"00000000-0000-0000-0000-00000000c001","role":"authenticated"}'
\set c_adm '{"sub":"00000000-0000-0000-0000-00000000c002","role":"authenticated"}'
\set c_mem '{"sub":"00000000-0000-0000-0000-00000000c003","role":"authenticated"}'
\set c_cli '{"sub":"00000000-0000-0000-0000-00000000c004","role":"authenticated"}'
\set c_o2  '{"sub":"00000000-0000-0000-0000-00000000c005","role":"authenticated"}'
\set c_ed  '{"sub":"00000000-0000-0000-0000-00000000c006","role":"authenticated"}'

-- _create_task_notification の行の kind（本 migration で変わる）
\set k_ctn chg

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

-- 呼んだ人の権限で、値を1つ返す SQL を流し、値を返す（巻き戻さない。できたものをあとで数えるため）
--   ok:<値> / err:<SQLSTATE>:<メッセージ>（エラーになった呼び出しは何も残さない）
create or replace function test.run(p_sql text)
returns text language plpgsql security invoker as $$
declare
  v text;
begin
  execute p_sql into v;
  return 'ok:' || coalesce(v, 'NULL');
exception when others then
  return 'err:' || sqlstate || ':' || sqlerrm;
end $$;

-- rpc_create_space_with_preset を呼ぶ SQL（マイルストーン 2 件・Wiki 2 ページ（うち home 1）で作る）。
--   値は、作れたら「created ms=<件数> wp=<件数>」、作れなかったら error の値
create or replace function test.create_space_sql(p_org uuid, p_name text)
returns text language sql stable as $$
  select format(
    'select case when (r->>%L)::boolean then format(%L, r->>%L, r->>%L) else r->>%L end'
    ' from (select public.rpc_create_space_with_preset(%L, %L, %L, %L::jsonb, %L::jsonb, null) as r) s',
    'ok', 'created ms=%s wp=%s', 'milestones_created', 'wiki_pages_created', 'error',
    p_org, p_name, 'blank',
    '[{"name":"m1","order_key":1},{"name":"m2","order_key":2}]',
    '[{"title":"spec","body":"b","tags":["spec"],"is_home":false},{"title":"home","body":"h","tags":[],"is_home":true}]');
$$;

-- -----------------------------------------------------------------------------
-- データ（postgres で投入。RLS は通らない）
-- -----------------------------------------------------------------------------
insert into public.organizations(id, name) values (:'O1', 'o1'), (:'O2', 'o2');
insert into auth.users(id) values
  (:'u_own'), (:'u_adm'), (:'u_mem'), (:'u_cli'), (:'u_o2'), (:'u_ed'), (:'u_rcv');
insert into public.org_memberships(org_id, user_id, role) values
  (:'O1', :'u_own', 'owner'),
  (:'O1', :'u_mem', 'member'),
  (:'O1', :'u_ed',  'member'),
  (:'O1', :'u_rcv', 'member'),
  (:'O1', :'u_cli', 'client'),
  (:'O2', :'u_o2',  'owner');
insert into public.spaces(id, org_id, type, name, owner_user_id) values
  (:'S1', :'O1', 'project', 's1', null);
insert into public.space_memberships(space_id, user_id, role) values
  (:'S1', :'u_ed', 'editor');
insert into public.api_keys(id, org_id, space_id, name, key_hash, key_prefix, created_by) values
  (:'K1', :'O1', :'S1', 'k1', md5('k1'), 'tsk_k1', :'u_own');
insert into public.tasks(id, org_id, space_id, title, status, ball, client_scope, created_by) values
  (:'T1', :'O1', :'S1', 't1', 'todo', 'internal', 'internal', :'u_ed');

-- -----------------------------------------------------------------------------
-- 実行権の表（関数を足したら行を足す）
--   列: public / anon / authenticated / service_role ごとに「chg|same:呼べるか(true|false)」
--   label は <chg|same>_<tag>_<who>_<can|cannot>_execute
-- -----------------------------------------------------------------------------
select test.check(
         split_part(x.spec, ':', 1) || '_' || e.tag || '_' || x.who || '_'
           || case when split_part(x.spec, ':', 2) = 'true' then 'can' else 'cannot' end || '_execute',
         has_function_privilege(x.who, e.fn, 'execute')::text,
         split_part(x.spec, ':', 2))
  from (values
    -- 節 A: サーバー（service role）と DB の中の関数・定期処理からだけ呼ぶ
    (1,  'a_dry_run',                 'public.mcp_dry_run_delete(uuid,uuid,text,uuid[])',                         'same:false', 'chg:false', 'chg:false', 'same:true'),
    (2,  'a_confirm',                 'public.mcp_confirm_delete(uuid,text)',                                     'same:false', 'chg:false', 'chg:false', 'same:true'),
    (3,  'a_create_task_notification', 'public._create_task_notification(uuid,uuid,uuid,text,text,jsonb)',
                                      :'k_ctn' || ':false', :'k_ctn' || ':false', :'k_ctn' || ':false', 'same:true'),
    (4,  'a_mcp_authorize',           'public.mcp_authorize(uuid,uuid,uuid,text,text,uuid)',                      'same:false', 'chg:false', 'chg:false', 'same:true'),
    (5,  'a_mcp_log_usage',           'public.mcp_log_usage(uuid,uuid,uuid,text,text,text,uuid,boolean,text,jsonb)', 'same:false', 'chg:false', 'chg:false', 'same:true'),
    (6,  'a_validate_api_key',        'public.rpc_validate_api_key(text)',                                        'chg:false',  'chg:false', 'chg:false', 'same:true'),
    (7,  'a_mfa_enforcement_status',  'public.mfa_enforcement_status()',                                          'same:false', 'chg:false', 'chg:false', 'same:true'),
    (8,  'a_decrypt_slack_token',     'public.decrypt_slack_token(text,text)',                                    'chg:false',  'chg:false', 'chg:false', 'same:true'),
    (9,  'a_encrypt_slack_token',     'public.encrypt_slack_token(text,text)',                                    'chg:false',  'chg:false', 'chg:false', 'same:true'),
    (10, 'a_decrypt_system_secret',   'public.decrypt_system_secret(text,text)',                                  'chg:false',  'chg:false', 'chg:false', 'same:true'),
    (11, 'a_encrypt_system_secret',   'public.encrypt_system_secret(text,text)',                                  'chg:false',  'chg:false', 'chg:false', 'same:true'),
    (12, 'a_scheduling_expirations',  'public.process_scheduling_expirations()',                                  'chg:false',  'chg:false', 'chg:false', 'same:true'),
    (13, 'a_scheduling_reminders',    'public.process_scheduling_reminders()',                                    'chg:false',  'chg:false', 'chg:false', 'same:true'),
    -- 節 B: ログイン中の本人のセッションから呼ぶ（組織の社内メンバーだけが作れる）
    (14, 'b_create_space',            'public.rpc_create_space_with_preset(uuid,text,text,jsonb,jsonb,boolean)',  'chg:false',  'chg:false', 'same:true', 'same:true'),
    -- 節 C: ログイン中の画面からだけ呼ぶ
    (15, 'c_show_owner_field',        'public.rpc_should_show_owner_field(uuid)',                                 'same:false', 'chg:false', 'same:true', 'same:true')
  ) as e(n, tag, fn, p_public, p_anon, p_authenticated, p_service_role)
  cross join lateral (values
    (1, 'public', e.p_public), (2, 'anon', e.p_anon),
    (3, 'authenticated', e.p_authenticated), (4, 'service_role', e.p_service_role)
  ) as x(k, who, spec)
 order by e.n, x.k;

-- 節 B の本文は、足した1行（role の確認）を除けば土台（20260705222754）と同じ。SECURITY DEFINER と search_path も同じ
select test.check('same_b_create_space_body_is_base_plus_role_check', (
  select 'definer=' || prosecdef::text || ',config=' || coalesce(array_to_string(proconfig, ';'), '')
         || ',md5=' || md5(replace(prosrc, E'\n      AND role IN (''owner'', ''admin'', ''member'')', ''))
  from pg_proc where oid = 'public.rpc_create_space_with_preset(uuid,text,text,jsonb,jsonb,boolean)'::regprocedure
), 'definer=true,config=search_path=public,md5=31fd307ea5882931c1bd0c2d6998cd0a');

-- -----------------------------------------------------------------------------
-- 節 A: anon / authenticated（組織の owner・社内の編集者のセッションでも）からは直接呼べない
-- -----------------------------------------------------------------------------
set role anon;
select set_config('request.jwt.claims', '', false);
select test.check('chg_a_dry_run_anon_call_denied',
  test.val(format('select public.mcp_dry_run_delete(%L, %L, %L, %L)::text', :'K1', :'S1', 'task', '{}')),
  'like:err:42501:%');
select test.check('chg_a_confirm_anon_call_denied',
  test.val(format('select public.mcp_confirm_delete(%L, %L)::text', :'K1', 'x')),
  'like:err:42501:%');
select test.check('chg_a_system_secret_anon_call_denied',
  test.val('select public.decrypt_system_secret(public.encrypt_system_secret(''hello'', ''k''), ''k'')'),
  'like:err:42501:%');
reset role;

set role authenticated;
select set_config('request.jwt.claims', :'c_own', false);
select test.check('chg_a_dry_run_authenticated_call_denied',
  test.val(format('select public.mcp_dry_run_delete(%L, %L, %L, %L)::text', :'K1', :'S1', 'task', '{}')),
  'like:err:42501:%');
select test.check('chg_a_confirm_authenticated_call_denied',
  test.val(format('select public.mcp_confirm_delete(%L, %L)::text', :'K1', 'x')),
  'like:err:42501:%');
select test.check('chg_a_system_secret_authenticated_call_denied',
  test.val('select public.decrypt_system_secret(public.encrypt_system_secret(''hello'', ''k''), ''k'')'),
  'like:err:42501:%');

select set_config('request.jwt.claims', :'c_ed', false);
select test.check(:'k_ctn' || '_a_create_task_notification_authenticated_call_denied',
  test.val(format('select public._create_task_notification(%L, %L, %L, %L, %L, %L::jsonb)::text',
                  :'O1', :'S1', :'u_rcv', 'direct', 'direct:1', '{}')),
  'like:err:42501:%');
reset role;

-- -----------------------------------------------------------------------------
-- 節 A: service_role（サーバー）からは呼べる
-- -----------------------------------------------------------------------------
set role service_role;
select set_config('request.jwt.claims', '', false);
-- MCP の流れ: dry run で受け取った確認用の合言葉（confirm_token）で confirm する
select test.check('same_a_service_role_dry_run_then_confirm',
  test.val(format('select (public.mcp_confirm_delete(%L, (public.mcp_dry_run_delete(%L, %L, %L, %L))->>%L))->>%L',
                  :'K1', :'K1', :'S1', 'task', '{}', 'confirm_token', 'success')),
  'ok:true');
-- 暗号化 → 復号の往復（連携の保存と読み出し）
select test.check('same_a_system_secret_service_role_round_trip',
  test.val('select public.decrypt_system_secret(public.encrypt_system_secret(''hello'', ''k''), ''k'')'),
  'ok:hello');
select test.check('same_a_slack_token_service_role_round_trip',
  test.val('select public.decrypt_slack_token(public.encrypt_slack_token(''hello'', ''k''), ''k'')'),
  'ok:hello');
-- マスター管理画面の二要素認証の確認
select test.check('same_a_mfa_enforcement_status_service_role_call',
  test.val('select public.mfa_enforcement_status()::text'),
  'like:ok:{%');
reset role;

-- -----------------------------------------------------------------------------
-- 節 A: DB の中の SECURITY DEFINER 関数からの呼び出しは今までどおり通る
--   社内の編集者がボールを渡すと（rpc_pass_ball → _create_task_notification）、受け取る人に通知ができる
-- -----------------------------------------------------------------------------
set role authenticated;
select set_config('request.jwt.claims', :'c_ed', false);
select test.check('same_a_definer_chain_pass_ball_ok',
  test.run(format('select public.rpc_pass_ball(%L, %L, %L::uuid[], %L::uuid[])::text',
                  :'T1', 'internal', '{}', '{' || :'u_rcv' || '}')),
  'ok:{"ok": true}');
reset role;
select test.check('same_a_definer_chain_pass_ball_notifies', (
  select count(*)::text from public.notifications
  where to_user_id = :'u_rcv' and type = 'ball_passed'
    and dedupe_key = format('ball_passed:%s:%s', :'T1', :'u_rcv')
), '1');

-- -----------------------------------------------------------------------------
-- 節 B: 組織の社内メンバー（owner / admin / member）だけが作れる。
--   相手先（client）・別の組織・ログイン中の利用者が無いセッション・未ログインは作れず、space も残らない
--   （作れた space は残し、名前で数える）
-- -----------------------------------------------------------------------------
set role anon;
select set_config('request.jwt.claims', '', false);
select test.check('chg_b_anon_call_denied', test.run(test.create_space_sql(:'O1', 'rda-anon')), 'like:err:42501:%');
reset role;

set role authenticated;
select set_config('request.jwt.claims', '', false);
select test.check('same_b_no_login_user_rejected', test.run(test.create_space_sql(:'O1', 'rda-nouid')), 'ok:authentication_required');

select set_config('request.jwt.claims', :'c_cli', false);
select test.check('chg_b_org_client_rejected', test.run(test.create_space_sql(:'O1', 'rda-cli')), 'ok:not_org_member');

select set_config('request.jwt.claims', :'c_o2', false);
select test.check('same_b_other_org_owner_rejected', test.run(test.create_space_sql(:'O1', 'rda-o2')), 'ok:not_org_member');

select set_config('request.jwt.claims', :'c_own', false);
select test.check('same_b_org_owner_creates', test.run(test.create_space_sql(:'O1', 'rda-own')), 'ok:created ms=2 wp=2');

select set_config('request.jwt.claims', :'c_mem', false);
select test.check('same_b_org_member_creates', test.run(test.create_space_sql(:'O1', 'rda-mem')), 'ok:created ms=2 wp=2');
reset role;

-- admin: 役割の制約を広げて admin の行を入れ、呼び出し、全部巻き戻す（結果だけ持ち出して記録する）
begin;
alter table public.org_memberships drop constraint org_memberships_role_check;
alter table public.org_memberships add constraint org_memberships_role_check
  check (role in ('owner', 'admin', 'member', 'client'));
insert into public.org_memberships(org_id, user_id, role) values (:'O1', :'u_adm', 'admin');
set local role authenticated;
select set_config('request.jwt.claims', :'c_adm', true);
select test.run(test.create_space_sql(:'O1', 'rda-adm')) as r_adm \gset
rollback;
select test.check('same_b_org_admin_creates', :'r_adm', 'ok:created ms=2 wp=2');

select test.check('chg_b_org_client_no_space_left',
  (select count(*)::text from public.spaces where name = 'rda-cli'), '0');
select test.check('same_b_rejected_calls_leave_no_space',
  (select count(*)::text from public.spaces where name in ('rda-anon', 'rda-nouid', 'rda-o2')), '0');

-- 作った人は space の admin になり、マイルストーンと Wiki ができる（本文の残りは変わっていない）
select test.check('same_b_org_member_space_is_set_up', (
  select string_agg(format('org=%s type=%s genre=%s creator=%s ms=%s wp=%s',
           (s.org_id = :'O1')::text, s.type, s.preset_genre, sm.role,
           (select count(*) from public.milestones m where m.space_id = s.id),
           (select count(*) from public.wiki_pages w where w.space_id = s.id)), ',')
  from public.spaces s
  left join public.space_memberships sm on sm.space_id = s.id and sm.user_id = :'u_mem'
  where s.name = 'rda-mem'
), 'org=true type=project genre=blank creator=admin ms=2 wp=2');

-- -----------------------------------------------------------------------------
-- 節 C: ログイン中の本人は呼べる。未ログインは呼べない
-- -----------------------------------------------------------------------------
set role anon;
select set_config('request.jwt.claims', '', false);
select test.check('chg_c_show_owner_field_anon_call_denied',
  test.val(format('select public.rpc_should_show_owner_field(%L)::text', :'S1')),
  'like:err:42501:%');
reset role;

set role authenticated;
select set_config('request.jwt.claims', :'c_ed', false);
select test.check('same_c_show_owner_field_authenticated_call_works',
  test.val(format('select public.rpc_should_show_owner_field(%L)::text', :'S1')),
  'like:ok:%');
reset role;

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
    raise exception 'RPC DEFINER AUTHZ CHECKS FAILED (% failures)', v_fail;
  end if;
end $$;
select 'RPC DEFINER AUTHZ CHECKS PASSED' as result;
