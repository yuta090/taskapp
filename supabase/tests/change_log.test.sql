-- =============================================================================
-- データの変更の控え（*_change_log.sql）の挙動検証
-- 前提: run_change_log.sh が migrations（本 migration を含む）を適用済み。
-- 人物・組織・プロジェクトは review_result_notify_seed.sql を使う（req = O1 owner・S1 admin）。
-- 出力: PASS[label] / FAIL[label]（ハーネスが数える）。
--   操作は1文ずつ（psql の自動コミット）。1文 = 1トランザクションなので、txid で文ごとに分かれる。
-- =============================================================================
set client_min_messages = notice;

\ir review_result_notify_seed.sql

\set O1 'a0000000-0000-0000-0000-000000000001'
\set S1 'b0000000-0000-0000-0000-000000000001'
\set u_req 'c0000000-0000-0000-0000-000000000001'
\set u_rv1 'c0000000-0000-0000-0000-000000000002'
\set u_rv2 'c0000000-0000-0000-0000-000000000003'
\set W1 'e0000000-0000-0000-0000-000000000001'
\set W2 'e0000000-0000-0000-0000-000000000002'
\set W3 'e0000000-0000-0000-0000-000000000003'
\set W4 'e0000000-0000-0000-0000-000000000004'
\set W5 'e0000000-0000-0000-0000-000000000005'
\set K1 'f0000000-0000-0000-0000-000000000001'

create schema if not exists test;

create or replace function test.check(p_label text, p_got text, p_want text)
returns void language plpgsql as $$
begin
  if p_got is not distinct from p_want then
    raise notice 'PASS[%]: %', p_label, p_got;
  else
    raise notice 'FAIL[%]: got %, want %', p_label, coalesce(p_got, 'NULL'), coalesce(p_want, 'NULL');
  end if;
end $$;

-- 役割・request.jwt.claims・request.headers を与えて SQL を1つ実行し、postgres に戻る
create or replace function test.run(p_role text, p_claims text, p_headers text, p_sql text)
returns text language plpgsql as $$
declare
  v_state text;
  v_msg text;
begin
  begin
    perform set_config('request.jwt.claims', coalesce(p_claims, ''), true);
    perform set_config('request.headers', coalesce(p_headers, ''), true);
    execute format('set local role %I', p_role);
    execute p_sql;
    execute 'reset role';
    return 'ok';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    return 'error:' || v_state;
  end;
end $$;

create or replace function test.user_claims(p_user uuid) returns text language sql as $$
  select json_build_object('sub', p_user, 'role', 'authenticated')::text
$$;

-- 表・行ごとの最新の控え
create or replace function test.last(p_table text, p_id text) returns public.change_log language sql as $$
  select * from public.change_log where table_name = p_table and row_pk ->> 'id' = p_id order by id desc limit 1
$$;

-- -----------------------------------------------------------------------------
-- 準備（postgres・system として）: Wiki のページ W1（親）・W2（W1 の子）・W3
-- -----------------------------------------------------------------------------
insert into public.wiki_pages (id, org_id, space_id, title, body, created_by, updated_by) values
  (:'W1', :'O1', :'S1', '消されるページ', repeat('本文', 500), :'u_req', :'u_req'),
  (:'W3', :'O1', :'S1', '書き換えるページ', 'はじめの本文', :'u_req', :'u_req');
insert into public.wiki_pages (id, org_id, space_id, title, body, parent_page_id, created_by, updated_by) values
  (:'W2', :'O1', :'S1', '子ページ', 'こ', :'W1', :'u_req', :'u_req');

select test.check('seed_insert_is_system',
  (select c.actor_kind || '/' || c.channel || '/' || c.op from test.last('wiki_pages', :'W3') c), 'system/system/I');
select test.check('seed_insert_body_is_len_md5',
  (select (c.new_row -> 'body')::text from test.last('wiki_pages', :'W3') c),
  json_build_object('len', length('はじめの本文'), 'md5', md5('はじめの本文'))::jsonb::text);
select test.check('seed_org_and_space_copied',
  (select c.org_id::text || '/' || c.space_id::text from test.last('wiki_pages', :'W3') c), :'O1' || '/' || :'S1');
select test.check('organizations_org_id_is_own_id',
  (select c.org_id::text from test.last('organizations', :'O1') c), :'O1');
select test.check('spaces_space_id_is_own_id',
  (select c.space_id::text || '/' || c.org_id::text from test.last('spaces', :'S1') c), :'S1' || '/' || :'O1');

-- -----------------------------------------------------------------------------
-- (a) ブラウザの利用者が Wiki のページを消す → 誰が消したか分かる・本文は全文・連鎖の変更は同じ txid
--     （子ページの parent_page_id が null になる更新。updated_at は既存のトリガーが進めるので変わった列に入る）
-- -----------------------------------------------------------------------------
select test.check('a_delete_ok',
  test.run('authenticated', test.user_claims(:'u_req'), null, format('delete from public.wiki_pages where id = %L', :'W1')), 'ok');
select test.check('a_delete_logged_as_user_app',
  (select c.op || '/' || c.actor_kind || '/' || c.actor_user_id::text || '/' || c.channel
     from test.last('wiki_pages', :'W1') c),
  'D/user/' || :'u_req' || '/app');
select test.check('a_delete_keeps_full_body',
  (select (c.old_row ->> 'body' = repeat('本文', 500))::text from test.last('wiki_pages', :'W1') c), 'true');
select test.check('a_delete_new_row_null',
  (select (c.new_row is null)::text from test.last('wiki_pages', :'W1') c), 'true');
select test.check('a_cascade_child_update_same_txid',
  (select (d.txid = u.txid)::text || '/' || u.op || '/' || array_to_string(u.changed_columns, ',')
            || '/' || u.actor_kind || '/' || u.actor_user_id::text
     from test.last('wiki_pages', :'W1') d, test.last('wiki_pages', :'W2') u),
  'true/U/parent_page_id,updated_at/user/' || :'u_req');

-- -----------------------------------------------------------------------------
-- (b) ログイン中の利用者が見出し（x-agentpm-*）を付けても、記録される人は auth.uid() のまま
-- -----------------------------------------------------------------------------
select test.check('b_update_ok',
  test.run('authenticated', test.user_claims(:'u_req'),
           json_build_object('x-agentpm-actor-id', :'u_rv1', 'x-agentpm-api-key-id', :'K1',
                             'x-agentpm-channel', 'cli', 'x-agentpm-request-id', 'req-b')::text,
           format('update public.wiki_pages set title = %L where id = %L', '見出し付き', :'W3')), 'ok');
select test.check('b_actor_stays_auth_uid',
  (select c.actor_kind || '/' || c.actor_user_id::text || '/' || c.channel || '/'
          || coalesce(c.api_key_id::text, 'null') || '/' || coalesce(c.request_id, 'null')
     from test.last('wiki_pages', :'W3') c),
  'user/' || :'u_req' || '/app/null/null');
select test.check('b_update_row_limited_to_changed',
  (select (select string_agg(k, ',' order by k) from jsonb_object_keys(c.new_row) k)
     from test.last('wiki_pages', :'W3') c),
  'id,org_id,space_id,title,updated_at');
select test.check('b_update_old_value',
  (select c.old_row ->> 'title' from test.last('wiki_pages', :'W3') c), '書き換えるページ');

-- -----------------------------------------------------------------------------
-- (c) サーバーの鍵（service_role）: 見出しで人と経路を記す。無ければ unattributed
-- -----------------------------------------------------------------------------
select test.check('c_service_insert_ok',
  test.run('service_role', '{"role":"service_role"}',
           json_build_object('x-agentpm-actor-id', :'u_rv1', 'x-agentpm-api-key-id', :'K1',
                             'x-agentpm-channel', 'cli', 'x-agentpm-request-id', 'req-c')::text,
           format('insert into public.wiki_pages (id, org_id, space_id, title, created_by, updated_by) values (%L, %L, %L, %L, %L, %L)',
                  :'W4', :'O1', :'S1', 'CLIから', :'u_rv1', :'u_rv1')), 'ok');
select test.check('c_service_with_key_is_api_key_cli',
  (select c.actor_kind || '/' || c.actor_user_id::text || '/' || c.api_key_id::text || '/' || c.channel || '/' || c.request_id
     from test.last('wiki_pages', :'W4') c),
  'api_key/' || :'u_rv1' || '/' || :'K1' || '/cli/req-c');

select test.check('c_service_actor_only_ok',
  test.run('service_role', '{"role":"service_role"}',
           json_build_object('x-agentpm-actor-id', :'u_rv1', 'x-agentpm-channel', 'mcp')::text,
           format('update public.wiki_pages set title = %L where id = %L', 'MCPから', :'W4')), 'ok');
select test.check('c_service_actor_only_is_user_mcp',
  (select c.actor_kind || '/' || c.actor_user_id::text || '/' || coalesce(c.api_key_id::text, 'null') || '/' || c.channel
     from test.last('wiki_pages', :'W4') c),
  'user/' || :'u_rv1' || '/null/mcp');

select test.check('c_service_no_headers_ok',
  test.run('service_role', '{"role":"service_role"}', null,
           format('update public.wiki_pages set title = %L where id = %L', '見出しなし', :'W4')), 'ok');
select test.check('c_service_no_headers_unattributed',
  (select c.actor_kind || '/' || coalesce(c.actor_user_id::text, 'null') || '/' || c.channel
     from test.last('wiki_pages', :'W4') c),
  'service/null/unattributed');

select test.check('c_service_bad_headers_ok',
  test.run('service_role', '{"role":"service_role"}',
           '{"x-agentpm-actor-id":"not-a-uuid","x-agentpm-api-key-id":"","x-agentpm-channel":"bogus"}',
           format('update public.wiki_pages set title = %L where id = %L', '壊れた見出し', :'W4')), 'ok');
select test.check('c_service_bad_headers_safe',
  (select c.actor_kind || '/' || coalesce(c.actor_user_id::text, 'null') || '/' || coalesce(c.api_key_id::text, 'null') || '/' || c.channel
     from test.last('wiki_pages', :'W4') c),
  'service/null/null/unattributed');

select test.check('c_service_headers_not_json_ok',
  test.run('service_role', '{"role":"service_role"}', 'not json',
           format('update public.wiki_pages set title = %L where id = %L', 'JSONでない見出し', :'W4')), 'ok');
select test.check('c_service_headers_not_json_safe',
  (select c.actor_kind || '/' || c.channel from test.last('wiki_pages', :'W4') c), 'service/unattributed');

select test.check('c_claims_not_json_ok',
  test.run('postgres', 'not json', '{"x-agentpm-actor-id":"c0000000-0000-0000-0000-000000000002"}',
           format('update public.wiki_pages set title = %L where id = %L', '設定が壊れている', :'W4')), 'ok');
select test.check('c_claims_not_json_is_system',
  (select c.actor_kind || '/' || coalesce(c.actor_user_id::text, 'null') || '/' || c.channel
     from test.last('wiki_pages', :'W4') c),
  'system/null/system');

select test.check('c_claims_bad_sub_ok',
  test.run('postgres', '{"sub":"xyz","role":"authenticated"}', null,
           format('update public.wiki_pages set title = %L where id = %L', 'subが壊れている', :'W4')), 'ok');
select test.check('c_claims_bad_sub_is_system',
  (select c.actor_kind || '/' || c.channel from test.last('wiki_pages', :'W4') c), 'system/system');

-- -----------------------------------------------------------------------------
-- (d) 秘密の列は伏せる・大きい本文は長さと md5 に縮める
-- -----------------------------------------------------------------------------
insert into public.api_keys (id, org_id, name, key_hash, key_prefix, created_by)
values (:'K1', :'O1', 'テストの鍵', 'hash-value-should-not-appear', 'agpm_te', :'u_req');
select test.check('d_api_key_hash_redacted',
  (select (c.new_row ->> 'key_hash') || '/' || (c.new_row ->> 'key_prefix') from test.last('api_keys', :'K1') c),
  '[redacted]/agpm_te');
select test.check('d_api_key_hash_absent_everywhere',
  (select count(*)::text from public.change_log where coalesce(old_row::text, '') || coalesce(new_row::text, '') like '%hash-value-should-not-appear%'),
  '0');

-- 定期更新の列（最終利用日時）だけの更新は控えない
update public.api_keys set last_used_at = now() where id = :'K1';
select test.check('d_api_key_last_used_only_not_logged',
  (select count(*)::text from public.change_log where table_name = 'api_keys' and op = 'U'), '0');

update public.api_keys set key_hash = 'another-secret-hash', name = '名前を変えた' where id = :'K1';
select test.check('d_api_key_hash_change_redacted_both',
  (select (c.old_row ->> 'key_hash') || '/' || (c.new_row ->> 'key_hash') || '/' || array_to_string(c.changed_columns, ',')
     from test.last('api_keys', :'K1') c),
  '[redacted]/[redacted]/key_hash,name');

select test.check('d_body_update_ok',
  test.run('authenticated', test.user_claims(:'u_req'), null,
           format('update public.wiki_pages set body = %L where id = %L', '新しい本文です', :'W3')), 'ok');
select test.check('d_body_update_len_md5',
  (select (c.old_row -> 'body')::text || ' -> ' || (c.new_row -> 'body')::text from test.last('wiki_pages', :'W3') c),
  json_build_object('len', length('はじめの本文'), 'md5', md5('はじめの本文'))::jsonb::text || ' -> '
    || json_build_object('len', length('新しい本文です'), 'md5', md5('新しい本文です'))::jsonb::text);

-- 主キーが2列の表
insert into public.org_email_templates (org_id, key, subject, heading, body, cta_label)
values (:'O1', 'invite_member', '件名', '見出し', '本文', 'ボタン');
select test.check('d_composite_pk',
  (select c.row_pk::text from public.change_log c where c.table_name = 'org_email_templates' order by c.id desc limit 1),
  json_build_object('org_id', :'O1', 'key', 'invite_member')::jsonb::text);

-- -----------------------------------------------------------------------------
-- (e) updated_at だけの更新は控えない
-- -----------------------------------------------------------------------------
select count(*) as before_e from public.change_log \gset
select test.check('e_updated_at_only_ok',
  test.run('authenticated', test.user_claims(:'u_req'), null,
           format('update public.wiki_pages set updated_at = now() + interval ''1 minute'' where id = %L', :'W3')), 'ok');
select test.check('e_updated_at_only_not_logged',
  (select (count(*) - :before_e)::text from public.change_log), '0');
select test.check('e_noop_update_not_logged',
  test.run('authenticated', test.user_claims(:'u_req'), null,
           format('update public.wiki_pages set title = title where id = %L', :'W3'))
    || '/' || (select (count(*) - :before_e)::text from public.change_log), 'ok/0');

-- -----------------------------------------------------------------------------
-- (f) 利用者の役割からは見えない・書けない・検索できない（運営者だけが検索できる）
-- -----------------------------------------------------------------------------
select test.check('f_auth_select_denied',
  test.run('authenticated', test.user_claims(:'u_req'), null, 'select 1 from public.change_log'), 'error:42501');
select test.check('f_auth_insert_denied',
  test.run('authenticated', test.user_claims(:'u_req'), null,
           $q$insert into public.change_log (txid, table_name, op, row_pk, actor_kind, channel) values (1, 'x', 'I', '{}', 'user', 'app')$q$),
  'error:42501');
select test.check('f_auth_update_denied',
  test.run('authenticated', test.user_claims(:'u_req'), null, $q$update public.change_log set channel = 'x'$q$), 'error:42501');
select test.check('f_auth_delete_denied',
  test.run('authenticated', test.user_claims(:'u_req'), null, 'delete from public.change_log'), 'error:42501');
select test.check('f_anon_select_denied',
  test.run('anon', null, null, 'select 1 from public.change_log'), 'error:42501');
select test.check('f_service_delete_denied',
  test.run('service_role', '{"role":"service_role"}', null, 'delete from public.change_log'), 'error:42501');
select test.check('f_service_select_ok',
  test.run('service_role', '{"role":"service_role"}', null, 'select 1 from public.change_log'), 'ok');
select test.check('f_search_non_superadmin_denied',
  test.run('authenticated', test.user_claims(:'u_req'), null, 'select * from public.rpc_change_log_search()'), 'error:42501');
select test.check('f_search_anon_denied',
  test.run('anon', null, null, 'select * from public.rpc_change_log_search()'), 'error:42501');
select test.check('f_redact_not_callable',
  test.run('authenticated', test.user_claims(:'u_req'), null, $q$select public.change_log_redact('x', '{}', 'I')$q$), 'error:42501');
select test.check('f_attach_not_callable',
  test.run('authenticated', test.user_claims(:'u_req'), null, $q$select public.change_log_attach('public.tasks')$q$), 'error:42501');

update public.profiles set is_superadmin = true where id = :'u_rv2';
create temp table search_out (n int, d_actor text);
grant all on search_out to authenticated;
select test.check('f_search_superadmin_ok',
  test.run('authenticated', test.user_claims(:'u_rv2'), null,
           format($q$insert into search_out select count(*), max(actor_user_id::text) filter (where op = 'D')
                     from public.rpc_change_log_search(p_table => 'wiki_pages', p_row_id => %L)$q$, :'W1')), 'ok');
select test.check('f_search_superadmin_finds_delete',
  (select n::text || '/' || d_actor from search_out), '2/' || :'u_req');

select test.check('f_capture_not_executable_by_users',
  (select has_function_privilege('authenticated', 'public.change_log_capture()', 'execute')::text || '/'
          || has_function_privilege('anon', 'public.change_log_capture()', 'execute')::text), 'false/false');

-- -----------------------------------------------------------------------------
-- (g) 入れ子の秘密（連携の metadata / import_config）は、どの深さでも伏せる
--     形は multica の接続（metadata.multica.*_secret_encrypted）・受信口（metadata.generic_inbound.*）・
--     kintone（import_config.kintone_app_tokens）に合わせる
-- -----------------------------------------------------------------------------
\set C1 'f1000000-0000-0000-0000-000000000001'
-- import_config.kintone_app_tokens はサーバーの鍵からしか書けない（既存のトリガー）ので、service_role で書く
select test.check('g_nested_insert_ok', test.run('service_role', '{"role":"service_role"}', null, $q$
insert into public.integration_connections (id, provider, owner_type, owner_id, org_id, access_token, auth_kind, metadata, import_config)
values ('f1000000-0000-0000-0000-000000000001', 'multica', 'org', 'a0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001', '', 'shared_secret',
  '{"multica": {"base_url": "https://multica.example", "send_secret_encrypted": "PLANT-SEND-CIPHER", "receive_secret_encrypted": "PLANT-RECV-CIPHER"},
    "generic_inbound": {"receive_secret_encrypted": "PLANT-GENERIC-CIPHER"},
    "list": [{"client_secret": "PLANT-LIST-SECRET", "name": "keep"}]}',
  '{"kintone_app_tokens": {"101": "PLANT-KINTONE-TOKEN"}, "target_space_id": "b0000000-0000-0000-0000-000000000001"}')
$q$), 'ok');
select test.check('g_nested_update_ok', test.run('service_role', '{"role":"service_role"}', null, $q$
update public.integration_connections
   set metadata = jsonb_set(metadata, '{multica,send_secret_encrypted}', '"PLANT-SEND-CIPHER-2"'),
       import_config = jsonb_set(import_config, '{kintone_app_tokens,102}', '"PLANT-KINTONE-TOKEN-2"')
 where id = 'f1000000-0000-0000-0000-000000000001'
$q$), 'ok');
select test.check('g_nested_update_logged',
  (select array_to_string(c.changed_columns, ',') from test.last('integration_connections', :'C1') c), 'import_config,metadata,updated_at');
select test.check('g_nested_keeps_harmless_values',
  (select (c.new_row #>> '{metadata,multica,base_url}') || '/' || (c.new_row #>> '{metadata,list,0,name}')
          || '/' || (c.new_row #>> '{import_config,target_space_id}')
     from public.change_log c where c.table_name = 'integration_connections' and c.op = 'I' and c.row_pk ->> 'id' = :'C1'),
  'https://multica.example/keep/' || :'S1');
select test.check('g_nested_marks_redacted',
  (select (c.new_row #>> '{metadata,multica,send_secret_encrypted}') || '/' || (c.new_row #>> '{import_config,kintone_app_tokens}')
     from test.last('integration_connections', :'C1') c),
  '[redacted]/[redacted]');
select test.check('g_nested_delete_ok', test.run('service_role', '{"role":"service_role"}', null,
  $q$delete from public.integration_connections where id = 'f1000000-0000-0000-0000-000000000001'$q$), 'ok');
select test.check('g_nested_secrets_absent_everywhere',
  (select count(*)::text from public.change_log
    where coalesce(old_row::text, '') || coalesce(new_row::text, '') like '%PLANT-%'), '0');
select test.check('g_nested_logged_three_ops',
  (select string_agg(op, '' order by id) from public.change_log where table_name = 'integration_connections' and row_pk ->> 'id' = :'C1'),
  'IUD');

-- -----------------------------------------------------------------------------
-- (h) Google Tasks のポーリングが metadata.poll_cursor だけを進める更新は控えない
-- -----------------------------------------------------------------------------
\set C2 'f1000000-0000-0000-0000-000000000002'
insert into public.integration_connections (id, provider, owner_type, owner_id, org_id, access_token, metadata)
values (:'C2', 'google_tasks', 'user', :'u_req', :'O1', '', '{"tasklist_id": "L1"}');
select count(*) as before_h from public.change_log \gset
update public.integration_connections set metadata = metadata || '{"poll_cursor": "2026-09-26T00:00:00Z"}' where id = :'C2';
update public.integration_connections
   set metadata = metadata || '{"poll_cursor": "2026-09-26T01:00:00Z"}', last_poll_attempt_at = now() where id = :'C2';
select test.check('h_poll_cursor_only_not_logged',
  (select (count(*) - :before_h)::text from public.change_log), '0');
update public.integration_connections set metadata = metadata || '{"poll_cursor": "c3", "tasklist_id": "L2"}' where id = :'C2';
select test.check('h_other_metadata_change_logged',
  (select array_to_string(c.changed_columns, ',') || '/' || (c.new_row #>> '{metadata,tasklist_id}')
     from test.last('integration_connections', :'C2') c), 'metadata,updated_at/L2');

-- -----------------------------------------------------------------------------
-- (i) 付いたトリガーの数 = 対象の一覧の数（60）
-- -----------------------------------------------------------------------------
select test.check('i_trigger_count',
  (select count(*)::text from pg_trigger where tgname = 'change_log_capture' and not tgisinternal), '60');

-- -----------------------------------------------------------------------------
-- (j) 行ごとの検索は (table_name, row_pk->>'id', id desc) の索引で引ける
-- -----------------------------------------------------------------------------
select test.check('j_row_index_exists',
  (select count(*)::text from pg_indexes where schemaname = 'public' and tablename = 'change_log'
      and indexdef like '%(table_name, ((row_pk ->> ''id''::text)), id DESC)%'), '1');
create or replace function test.plan_uses_row_index() returns text language plpgsql as $$
declare v_line text; v_all text := '';
begin
  set local enable_seqscan = off;
  set local enable_bitmapscan = off;
  for v_line in execute
    $q$explain select * from public.change_log where table_name = 'wiki_pages' and (row_pk ->> 'id') = 'x' order by id desc limit 100$q$
  loop
    v_all := v_all || v_line;
  end loop;
  return (v_all like '%change_log_table_row_id_idx%' and v_all not like '%Sort%')::text;
end $$;
select test.check('j_row_query_uses_index', test.plan_uses_row_index(), 'true');
