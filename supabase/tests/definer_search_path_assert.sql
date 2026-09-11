-- =============================================================================
-- SECURITY DEFINER の関数の search_path（*_definer_search_path.sql）の挙動検証
-- 前提: run_definer_search_path.sh が _local_bootstrap → Supabase の権限と拡張の置き場所の代役 → migrations を
--   verbatim 適用済み（RED=1 のときは本 migration だけ適用しない）。pgcrypto は本番と同じく extensions にある。
--   本文・SECURITY DEFINER・持ち主・実行権が変わらないことは、ハーネスが適用前後のスキーマの指紋で確かめる（scope_*）。
--
-- セッションの search_path（名前を探す場所）を切り替えて呼ぶ:
--   public              セッションに extensions が無いとき
--   public, extensions  サーバー（API）から呼ぶときと同じ
--   ''（空）            セッションに何も無いとき（関数が自分の search_path だけで表や関数を見つけられるか）
--
-- データ: 組織 O1（space S1・API キー K1・タスク T1〜T4・T1 の価格・招待 1 件）。
-- 人物（request.jwt.claims の sub で切り替える）:
--   own  O1 owner
--   adm  O1 member・S1 admin
--   ed   O1 member・S1 editor
--   vw   O1 member・S1 viewer
--   vnd  O1 member・S1 vendor
--   sa   運営（profiles.is_superadmin）
-- トリガーの見張り（spaces・task_pricing）は postgres のまま人物だけを切り替えて書く（RLS を通らないので、
--   止めるかどうかは見張りだけで決まる）。service_role は set role で切り替える。
--
-- label:
--   chg_*   本 migration で結果が変わるもの（適用前は FAIL・適用後は PASS であるべき）
--   same_*  適用前後で結果が同じであるべきもの（両方で PASS）
-- 関数を足したら test.targets に行を足す。
-- 出力: PASS[label] / FAIL[label]。最後に FAIL が 0 件なら "DEFINER SEARCH PATH CHECKS PASSED"。
--   1件でもあれば例外で終了する。
-- =============================================================================
set client_min_messages = notice;
set search_path = public, extensions;

\set O1 '00000000-0000-0000-0000-00000000a001'
\set S1 '00000000-0000-0000-0000-00000000b001'
\set K1 '00000000-0000-0000-0000-00000000f001'
\set KRAW 'tsk_definersearchpathprobekey000'
\set T1 '00000000-0000-0000-0000-00000000d001'
\set T2 '00000000-0000-0000-0000-00000000d002'
\set T3 '00000000-0000-0000-0000-00000000d003'
\set T4 '00000000-0000-0000-0000-00000000d004'
\set u_own '00000000-0000-0000-0000-00000000c001'
\set u_adm '00000000-0000-0000-0000-00000000c002'
\set u_ed  '00000000-0000-0000-0000-00000000c003'
\set u_vw  '00000000-0000-0000-0000-00000000c004'
\set u_vnd '00000000-0000-0000-0000-00000000c005'
\set u_sa  '00000000-0000-0000-0000-00000000c006'

\set c_own '{"sub":"00000000-0000-0000-0000-00000000c001","role":"authenticated"}'
\set c_adm '{"sub":"00000000-0000-0000-0000-00000000c002","role":"authenticated"}'
\set c_ed  '{"sub":"00000000-0000-0000-0000-00000000c003","role":"authenticated"}'
\set c_vw  '{"sub":"00000000-0000-0000-0000-00000000c004","role":"authenticated"}'
\set c_vnd '{"sub":"00000000-0000-0000-0000-00000000c005","role":"authenticated"}'
\set c_sa  '{"sub":"00000000-0000-0000-0000-00000000c006","role":"authenticated"}'

-- -----------------------------------------------------------------------------
-- 検証ヘルパ
-- -----------------------------------------------------------------------------
create schema if not exists test;
grant usage on schema test to anon, authenticated, service_role;
create table test.results (seq serial primary key, label text, ok boolean, got text, want text);

-- 結果の記録（definer: anon / authenticated / service_role の視点・どの search_path のままでも記録できる）
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

-- 呼んだ人の権限とセッションの search_path のまま、値を1つ返す SQL を流し、値を返して必ず巻き戻す
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

-- MCP の削除の流れ（dry run → 受け取った確認用の合言葉で confirm → 同じ合言葉はもう使えない）を1回で流し、
--   結果を1行で返す。呼んだ人の権限とセッションの search_path のまま流す（test.val の中で呼んで巻き戻す）
create or replace function test.mcp_round_trip(p_key uuid, p_space uuid, p_ids uuid[])
returns text language plpgsql security invoker as $$
declare
  v_dry jsonb;
  v_confirm jsonb;
  v_again jsonb;
begin
  v_dry := public.mcp_dry_run_delete(p_key, p_space, 'task', p_ids);
  v_confirm := public.mcp_confirm_delete(p_key, v_dry ->> 'confirm_token');
  v_again := public.mcp_confirm_delete(p_key, v_dry ->> 'confirm_token');
  return format('dry=%s affected=%s confirm=%s deleted=%s left=%s reuse=%s',
                v_dry ->> 'success', v_dry ->> 'affected_count',
                v_confirm ->> 'success', v_confirm ->> 'deleted_count',
                (select count(*) from public.tasks where id = any (p_ids)),
                v_again ->> 'success');
end $$;

-- 対象の 17 本と、固定する search_path（関数を足したら行を足す）
create table test.targets (n int primary key, name text, fn text, want text);
insert into test.targets values
  (1,  'rpc_create_invite',             'rpc_create_invite(uuid,uuid,text,text,uuid)', 'search_path=public'),
  (2,  'rpc_get_space_members',         'rpc_get_space_members(uuid)',                 'search_path=public'),
  (3,  'rpc_should_show_owner_field',   'rpc_should_show_owner_field(uuid)',           'search_path=public'),
  (4,  'rpc_validate_invite',           'rpc_validate_invite(text)',                   'search_path=public'),
  (5,  'rpc_get_org_members',           'rpc_get_org_members(uuid)',                   'search_path=public'),
  (6,  'rpc_is_superadmin',             'rpc_is_superadmin()',                         'search_path=public'),
  (7,  'guard_portal_visible_sections', 'guard_portal_visible_sections()',             'search_path=public'),
  (8,  'guard_agency_settings',         'guard_agency_settings()',                     'search_path=public'),
  (9,  'guard_task_pricing_write',      'guard_task_pricing_write()',                  'search_path=public'),
  (10, 'guard_task_pricing_delete',     'guard_task_pricing_delete()',                 'search_path=public'),
  (11, 'encrypt_slack_token',           'encrypt_slack_token(text,text)',              'search_path=public, extensions'),
  (12, 'decrypt_slack_token',           'decrypt_slack_token(text,text)',              'search_path=public, extensions'),
  (13, 'encrypt_system_secret',         'encrypt_system_secret(text,text)',            'search_path=public, extensions'),
  (14, 'decrypt_system_secret',         'decrypt_system_secret(text,text)',            'search_path=public, extensions'),
  (15, 'rpc_validate_api_key',          'rpc_validate_api_key(text)',                  'search_path=public, extensions'),
  (16, 'mcp_dry_run_delete',            'mcp_dry_run_delete(uuid,uuid,text,uuid[])',   'search_path=public, extensions'),
  (17, 'mcp_confirm_delete',            'mcp_confirm_delete(uuid,text)',               'search_path=public, extensions');

-- -----------------------------------------------------------------------------
-- 関数の設定: 17 本の search_path が固定の値になる。SECURITY DEFINER と持ち主はそのまま
-- -----------------------------------------------------------------------------
select test.check('chg_path_' || t.name,
         coalesce((select coalesce(array_to_string(p.proconfig, ';'), '(none)')
                     from pg_proc p where p.oid = to_regprocedure('public.' || t.fn)), '(missing)'),
         t.want)
  from test.targets t
 order by t.n;

select test.check('same_targets_definer_owned_by_postgres', (
  select count(*)::text
    from test.targets t
    join pg_proc p on p.oid = to_regprocedure('public.' || t.fn)
   where p.prosecdef and p.proowner = 'postgres'::regrole
), '17');

-- public の SECURITY DEFINER の関数は、どれも search_path を持つ
select test.check('chg_public_definer_functions_all_have_search_path', (
  select coalesce(string_agg(p.oid::regprocedure::text, ',' order by p.oid::regprocedure::text), 'none')
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosecdef
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
), 'none');

-- pgcrypto の関数を名前で呼ぶ SECURITY DEFINER の関数は、どれも search_path に extensions を持つ
select test.check('chg_definer_pgcrypto_callers_have_extensions', (
  select coalesce(string_agg(p.oid::regprocedure::text, ',' order by p.oid::regprocedure::text), 'none')
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosecdef
     and p.prosrc ~* '(^|[^a-z_.])(digest|hmac|gen_random_bytes|gen_salt|crypt|pgp_sym_encrypt|pgp_sym_decrypt|pgp_pub_encrypt|pgp_pub_decrypt|armor|dearmor|encrypt|decrypt)[[:space:]]*[(]'
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c ~ 'extensions')
), 'none');

-- -----------------------------------------------------------------------------
-- データ（postgres で投入。RLS は通らない）
-- -----------------------------------------------------------------------------
insert into public.organizations(id, name) values (:'O1', 'o1');
-- profiles は auth.users に行を足すと自動でできる（on_auth_user_created）。運営の印は postgres で付ける
insert into auth.users(id, email) values
  (:'u_own', 'own@example.com'), (:'u_adm', 'adm@example.com'), (:'u_ed', 'ed@example.com'),
  (:'u_vw', 'vw@example.com'), (:'u_vnd', 'vnd@example.com'), (:'u_sa', 'sa@example.com');
update public.profiles set is_superadmin = true where id = :'u_sa';
insert into public.org_memberships(org_id, user_id, role) values
  (:'O1', :'u_own', 'owner'),
  (:'O1', :'u_adm', 'member'),
  (:'O1', :'u_ed',  'member'),
  (:'O1', :'u_vw',  'member'),
  (:'O1', :'u_vnd', 'member');
insert into public.spaces(id, org_id, type, name) values (:'S1', :'O1', 'project', 's1');
insert into public.space_memberships(space_id, user_id, role) values
  (:'S1', :'u_adm', 'admin'),
  (:'S1', :'u_ed',  'editor'),
  (:'S1', :'u_vw',  'viewer'),
  (:'S1', :'u_vnd', 'vendor');
-- API キー（key_hash は合言葉の sha256。pg_catalog の sha256 は pgcrypto の digest と同じ値）
insert into public.api_keys(id, org_id, space_id, name, key_hash, key_prefix, created_by) values
  (:'K1', :'O1', :'S1', 'k1', encode(sha256(convert_to(:'KRAW', 'UTF8')), 'hex'), 'tsk_defi', :'u_own');
insert into public.tasks(id, org_id, space_id, title, status, ball, client_scope, created_by) values
  (:'T1', :'O1', :'S1', 't1', 'todo', 'internal', 'internal', :'u_ed'),
  (:'T2', :'O1', :'S1', 't2', 'todo', 'internal', 'internal', :'u_ed'),
  (:'T3', :'O1', :'S1', 't3', 'todo', 'internal', 'internal', :'u_ed'),
  (:'T4', :'O1', :'S1', 't4', 'todo', 'internal', 'internal', :'u_ed');
insert into public.invites(org_id, space_id, email, role, token, expires_at, created_by) values
  (:'O1', :'S1', 'invitee@example.com', 'member', 'dsp-invite-token', now() + interval '1 day', :'u_own');
-- T1 の価格（見張りは書いた人の役割を見るので、編集者として入れる）
select set_config('request.jwt.claims', :'c_ed', false);
insert into public.task_pricing(org_id, space_id, task_id, cost_hours, cost_unit_price) values
  (:'O1', :'S1', :'T1', 1, 1000);
select set_config('request.jwt.claims', '', false);
-- すでに保存してある暗号文の代わり（extensions の pgcrypto で直接作る）
select encode(extensions.pgp_sym_encrypt('stored-secret', 'k'), 'base64') as stored_cipher \gset

-- -----------------------------------------------------------------------------
-- pgcrypto を使う関数（サーバー = service_role から呼ぶ）
--   セッションの search_path が public だけでも通る（chg_）。API と同じ search_path では前から通る（same_）
-- -----------------------------------------------------------------------------
set role service_role;
select set_config('request.jwt.claims', '', false);

set search_path = public;
-- 暗号化 → 復号の往復（連携の保存と読み出し）と、すでに保存してある暗号文の読み出し
select test.check('chg_a_system_secret_round_trip_session_public',
  test.val('select public.decrypt_system_secret(public.encrypt_system_secret(''hello'', ''k''), ''k'')'),
  'ok:hello');
select test.check('chg_a_slack_token_round_trip_session_public',
  test.val('select public.decrypt_slack_token(public.encrypt_slack_token(''hello'', ''k''), ''k'')'),
  'ok:hello');
select test.check('chg_a_system_secret_reads_stored_session_public',
  test.val(format('select public.decrypt_system_secret(%L, %L)', :'stored_cipher', 'k')),
  'ok:stored-secret');
select test.check('chg_a_slack_token_reads_stored_session_public',
  test.val(format('select public.decrypt_slack_token(%L, %L)', :'stored_cipher', 'k')),
  'ok:stored-secret');
-- API キーの確かめ（合っている鍵は見つかり、違う鍵は見つからない）
select test.check('chg_a_validate_api_key_session_public',
  test.val(format('select key_id::text from public.rpc_validate_api_key(%L)', :'KRAW')),
  'ok:' || :'K1');
select test.check('chg_a_validate_api_key_wrong_key_session_public',
  test.val(format('select count(*)::text from public.rpc_validate_api_key(%L)', 'tsk_wrong')),
  'ok:0');
-- MCP の削除: dry run → confirm で 2 件消え、同じ合言葉はもう使えない
select test.check('chg_b_mcp_dry_run_then_confirm_session_public',
  test.val(format('select test.mcp_round_trip(%L, %L, %L)', :'K1', :'S1', '{' || :'T3' || ',' || :'T4' || '}')),
  'ok:dry=true affected=2 confirm=true deleted=2 left=0 reuse=false');

set search_path = public, extensions;
select test.check('same_a_system_secret_round_trip_api_path',
  test.val('select public.decrypt_system_secret(public.encrypt_system_secret(''hello'', ''k''), ''k'')'),
  'ok:hello');
select test.check('same_a_slack_token_round_trip_api_path',
  test.val('select public.decrypt_slack_token(public.encrypt_slack_token(''hello'', ''k''), ''k'')'),
  'ok:hello');
select test.check('same_a_validate_api_key_api_path',
  test.val(format('select key_id::text from public.rpc_validate_api_key(%L)', :'KRAW')),
  'ok:' || :'K1');
-- search_path = public だった 2 本は、API と同じ search_path でも関数自身の search_path で名前を探す
select test.check('chg_b_mcp_dry_run_then_confirm_api_path',
  test.val(format('select test.mcp_round_trip(%L, %L, %L)', :'K1', :'S1', '{' || :'T3' || ',' || :'T4' || '}')),
  'ok:dry=true affected=2 confirm=true deleted=2 left=0 reuse=false');
reset role;

-- 巻き戻したので、T3・T4 は残り、確認用の合言葉は 0 件のまま
select test.check('same_mcp_checks_left_no_change', (
  select format('tasks=%s tokens=%s',
                (select count(*) from public.tasks where id in (:'T3', :'T4')),
                (select count(*) from public.mcp_confirm_tokens))
), 'tasks=2 tokens=0');

-- -----------------------------------------------------------------------------
-- public の表だけを使う関数（画面・招待リンクから呼ぶ）
--   API と同じ search_path では前から通る（same_）。セッションの search_path が空でも通る（chg_）
-- -----------------------------------------------------------------------------
set search_path = public, extensions;

set role authenticated;
select set_config('request.jwt.claims', :'c_sa', false);
select test.check('same_a_is_superadmin_api_path', test.val('select public.rpc_is_superadmin()::text'), 'ok:true');
select set_config('request.jwt.claims', :'c_vw', false);
select test.check('same_a_is_superadmin_non_admin_api_path', test.val('select public.rpc_is_superadmin()::text'), 'ok:false');
select set_config('request.jwt.claims', :'c_ed', false);
select test.check('same_a_should_show_owner_field_api_path',
  test.val(format('select public.rpc_should_show_owner_field(%L)::text', :'S1')), 'ok:false');
select test.check('same_a_get_space_members_api_path',
  test.val(format('select string_agg(m.role, %L order by m.role) from public.rpc_get_space_members(%L) m', ',', :'S1')),
  'ok:admin,editor,vendor,viewer');
select set_config('request.jwt.claims', :'c_own', false);
select test.check('same_a_get_org_members_api_path',
  test.val(format('select count(*)::text from public.rpc_get_org_members(%L)', :'O1')), 'ok:5');
select test.check('same_a_create_invite_api_path',
  test.val(format('select ((public.rpc_create_invite(%L, %L, %L, %L, %L)) ->> %L is not null)::text',
                  :'O1', :'S1', 'new-client@example.com', 'client', :'u_own', 'token')),
  'ok:true');
reset role;
set role anon;
select set_config('request.jwt.claims', '', false);
select test.check('same_a_validate_invite_api_path',
  test.val(format('select (public.rpc_validate_invite(%L)) ->> %L', 'dsp-invite-token', 'valid')), 'ok:true');
reset role;

set search_path = '';

set role authenticated;
select set_config('request.jwt.claims', :'c_sa', false);
select test.check('chg_a_is_superadmin_empty_path', test.val('select public.rpc_is_superadmin()::text'), 'ok:true');
select set_config('request.jwt.claims', :'c_vw', false);
select test.check('chg_a_is_superadmin_non_admin_empty_path', test.val('select public.rpc_is_superadmin()::text'), 'ok:false');
select set_config('request.jwt.claims', :'c_ed', false);
select test.check('chg_a_should_show_owner_field_empty_path',
  test.val(format('select public.rpc_should_show_owner_field(%L)::text', :'S1')), 'ok:false');
select test.check('chg_a_get_space_members_empty_path',
  test.val(format('select string_agg(m.role, %L order by m.role) from public.rpc_get_space_members(%L) m', ',', :'S1')),
  'ok:admin,editor,vendor,viewer');
select set_config('request.jwt.claims', :'c_own', false);
select test.check('chg_a_get_org_members_empty_path',
  test.val(format('select count(*)::text from public.rpc_get_org_members(%L)', :'O1')), 'ok:5');
select test.check('chg_a_create_invite_empty_path',
  test.val(format('select ((public.rpc_create_invite(%L, %L, %L, %L, %L)) ->> %L is not null)::text',
                  :'O1', :'S1', 'new-client@example.com', 'client', :'u_own', 'token')),
  'ok:true');
reset role;
set role anon;
select set_config('request.jwt.claims', '', false);
select test.check('chg_a_validate_invite_empty_path',
  test.val(format('select (public.rpc_validate_invite(%L)) ->> %L', 'dsp-invite-token', 'valid')), 'ok:true');
reset role;

set search_path = public, extensions;
select test.check('same_invite_checks_left_no_invite', (
  select count(*)::text from public.invites where email = 'new-client@example.com'
), '0');

-- -----------------------------------------------------------------------------
-- トリガーの見張り（spaces・task_pricing）
--   セッションの search_path が public のとき: 止めるべき人は止まり、通すべき人は通る（前から同じ = same_）
--   セッションの search_path が空のとき: 同じ判定になる（chg_。見張りが自分の search_path で表を見つける）
-- -----------------------------------------------------------------------------
\set upd_portal 'update public.spaces set portal_visible_sections = jsonb_set(portal_visible_sections, ''{wiki}'', to_jsonb(not (portal_visible_sections ->> ''wiki'')::boolean)) where id = ''00000000-0000-0000-0000-00000000b001'' returning ''updated'''
\set upd_agency 'update public.spaces set agency_mode = not agency_mode where id = ''00000000-0000-0000-0000-00000000b001'' returning ''updated'''
\set ins_pricing 'insert into public.task_pricing(org_id, space_id, task_id) values (''00000000-0000-0000-0000-00000000a001'', ''00000000-0000-0000-0000-00000000b001'', ''00000000-0000-0000-0000-00000000d002'') returning ''inserted'''
\set upd_pricing 'update public.task_pricing set cost_hours = 2 where task_id = ''00000000-0000-0000-0000-00000000d001'' returning ''updated'''
\set del_pricing 'delete from public.task_pricing where task_id = ''00000000-0000-0000-0000-00000000d001'' returning ''deleted'''

set search_path = public;
select set_config('request.jwt.claims', :'c_vw', false);
select test.check('same_trg_portal_sections_viewer_blocked', test.val(:'upd_portal'),
  'like:err:P0001:permission denied: only admin/editor can update portal_visible_sections');
select test.check('same_trg_agency_viewer_blocked', test.val(:'upd_agency'),
  'like:err:P0001:permission denied: only admin/editor can update agency settings');
select test.check('same_trg_pricing_insert_viewer_blocked', test.val(:'ins_pricing'),
  'like:err:P0001:permission denied: only admin/editor/vendor can modify task pricing');
select test.check('same_trg_pricing_update_viewer_blocked', test.val(:'upd_pricing'),
  'like:err:P0001:permission denied: only admin/editor/vendor can modify task pricing');
select set_config('request.jwt.claims', :'c_vnd', false);
select test.check('same_trg_pricing_insert_vendor_allowed', test.val(:'ins_pricing'), 'ok:inserted');
select test.check('same_trg_pricing_delete_vendor_blocked', test.val(:'del_pricing'),
  'like:err:P0001:permission denied: only admin/editor can delete task pricing');
select set_config('request.jwt.claims', :'c_adm', false);
select test.check('same_trg_portal_sections_admin_allowed', test.val(:'upd_portal'), 'ok:updated');
select set_config('request.jwt.claims', :'c_ed', false);
select test.check('same_trg_agency_editor_allowed', test.val(:'upd_agency'), 'ok:updated');
select test.check('same_trg_pricing_delete_editor_allowed', test.val(:'del_pricing'), 'ok:deleted');
select set_config('request.jwt.claims', '', false);
set role service_role;
select test.check('same_trg_portal_sections_service_role_allowed', test.val(:'upd_portal'), 'ok:updated');
select test.check('same_trg_pricing_insert_service_role_allowed', test.val(:'ins_pricing'), 'ok:inserted');
reset role;

set search_path = '';
select set_config('request.jwt.claims', :'c_vw', false);
select test.check('chg_trg_portal_sections_viewer_blocked_empty_path', test.val(:'upd_portal'),
  'like:err:P0001:permission denied: only admin/editor can update portal_visible_sections');
select test.check('chg_trg_pricing_insert_viewer_blocked_empty_path', test.val(:'ins_pricing'),
  'like:err:P0001:permission denied: only admin/editor/vendor can modify task pricing');
select set_config('request.jwt.claims', :'c_vnd', false);
select test.check('chg_trg_pricing_insert_vendor_allowed_empty_path', test.val(:'ins_pricing'), 'ok:inserted');
select test.check('chg_trg_pricing_delete_vendor_blocked_empty_path', test.val(:'del_pricing'),
  'like:err:P0001:permission denied: only admin/editor can delete task pricing');
select set_config('request.jwt.claims', :'c_adm', false);
select test.check('chg_trg_portal_sections_admin_allowed_empty_path', test.val(:'upd_portal'), 'ok:updated');
select set_config('request.jwt.claims', :'c_ed', false);
select test.check('chg_trg_agency_editor_allowed_empty_path', test.val(:'upd_agency'), 'ok:updated');
select test.check('chg_trg_pricing_delete_editor_allowed_empty_path', test.val(:'del_pricing'), 'ok:deleted');
select set_config('request.jwt.claims', '', false);

set search_path = public, extensions;
-- 巻き戻したので、価格の行は T1 の 1 件だけのまま
select test.check('same_trigger_checks_left_no_change', (
  select string_agg(task_id::text, ',') from public.task_pricing
), :'T1');

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
    raise exception 'DEFINER SEARCH PATH CHECKS FAILED (% failures)', v_fail;
  end if;
end $$;
select 'DEFINER SEARCH PATH CHECKS PASSED' as result;
