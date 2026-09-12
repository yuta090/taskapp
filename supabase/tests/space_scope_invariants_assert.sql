-- =============================================================================
-- space と組織の境目を DB でも守る（*_space_scope_invariants.sql）の挙動検証
-- 前提: run_space_scope_invariants.sh が _local_bootstrap → Supabase の権限の代役 → migrations →
--   space_scope_invariants_seed.sql → 本 migration（RED=1 のときは本 migration だけ流さない）。
--   データと人物は seed のとおり。
-- CLI / MCP の道具と同じ書き込みは set role service_role（RLS を通らない）。
-- 画面と同じ書き込みは set role authenticated ＋ request.jwt.claims（RLS を通る）。
--
-- label:
--   chg_*    本 migration で変わるもの（適用前は FAIL・適用後は PASS であるべき）
--   same_*   本 migration で変えないもの（両方で PASS）
-- 出力: PASS[label] / FAIL[label]。最後に FAIL が 0 件なら "SPACE SCOPE INVARIANTS CHECKS PASSED"。
--   1件でもあれば例外で終了する。書き込みはサブトランザクションで実行し、必ず巻き戻す（各 assert は独立）。
-- =============================================================================
set client_min_messages = notice;

\set O1 '00000000-0000-0000-0000-00000000a001'
\set O2 '00000000-0000-0000-0000-00000000a002'
\set Od '00000000-0000-0000-0000-00000000a009'
\set S1 '00000000-0000-0000-0000-00000000b001'
\set S2 '00000000-0000-0000-0000-00000000b002'
\set S3 '00000000-0000-0000-0000-00000000b003'
\set Sd '00000000-0000-0000-0000-00000000b009'
\set u_own '00000000-0000-0000-0000-00000000c001'
\set u_ed '00000000-0000-0000-0000-00000000c002'
\set u_out '00000000-0000-0000-0000-00000000c004'
\set u_nu1 '00000000-0000-0000-0000-00000000c005'
\set u_nu2 '00000000-0000-0000-0000-00000000c006'
\set u_nu3 '00000000-0000-0000-0000-00000000c007'
\set u_d1 '00000000-0000-0000-0000-00000000c011'
\set u_d2 '00000000-0000-0000-0000-00000000c012'
\set u_d3 '00000000-0000-0000-0000-00000000c013'
\set u_v1 '00000000-0000-0000-0000-00000000c014'
\set W1 '00000000-0000-0000-0000-00000000e101'
\set W2 '00000000-0000-0000-0000-00000000e102'
\set W3 '00000000-0000-0000-0000-00000000e103'
\set T0 '00000000-0000-0000-0000-00000000d001'
\set T1 '00000000-0000-0000-0000-00000000d002'
\set K_user '00000000-0000-0000-0000-00000000f001'
\set K_space '00000000-0000-0000-0000-00000000f002'
\set c_ed '{"sub":"00000000-0000-0000-0000-00000000c002","role":"authenticated"}'
-- 本 migration の mcp_authorize の本文の md5
\set new_md5 '78b4d4465b0c123e17a433e420f53fea'

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

-- 行を RLS に隠されずに読む
create or replace function test.task_wiki(p_id uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  select coalesce(t.wiki_page_id::text, 'null') into v from public.tasks t where t.id = p_id;
  if not found then return '(no row)'; end if;
  return v;
end $$;

create or replace function test.space_role(p_space uuid, p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select sm.role from public.space_memberships sm where sm.space_id = p_space and sm.user_id = p_user), '(no row)')
$$;

create or replace function test.org_space_roles(p_org uuid, p_space uuid, p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select om.role from public.org_memberships om where om.org_id = p_org and om.user_id = p_user), '-')
         || '/' || coalesce((select sm.role from public.space_memberships sm where sm.space_id = p_space and sm.user_id = p_user), '-')
$$;

-- 関数を作る migration が「既定の実行権を付けない」ので、補助関数は明示で grant する
grant execute on all functions in schema test to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 形: トリガー2本（決めた列の insert / update の前に行ごと）・トリガー関数は DEFINER と search_path = public で
--   直接は実行できない・招待の組み合わせ外部キー・mcp_authorize の本文と実行権
-- -----------------------------------------------------------------------------
\echo '== shape =='
select test.check('chg_triggers_shape', (
  select coalesce(string_agg(format('%s:%s:%s', t.tgname, t.tgenabled::text, (pg_get_triggerdef(t.oid) like e.def_like)::text),
                             ',' order by t.tgname collate "C"), 'none')
  from (values
    ('public.tasks'::regclass, 'trg_enforce_wiki_page_same_space',
     '%BEFORE INSERT OR UPDATE OF wiki_page_id, space_id, org_id ON public.tasks FOR EACH ROW EXECUTE FUNCTION %enforce_wiki_page_same_space()'),
    ('public.space_memberships'::regclass, 'trg_enforce_space_member_in_org',
     '%BEFORE INSERT OR UPDATE OF space_id, user_id ON public.space_memberships FOR EACH ROW EXECUTE FUNCTION %enforce_space_member_in_org()')
  ) as e(rel, name, def_like)
  join pg_trigger t on t.tgrelid = e.rel and t.tgname = e.name and not t.tgisinternal
), 'trg_enforce_space_member_in_org:O:true,trg_enforce_wiki_page_same_space:O:true');

select test.check('chg_functions_shape', (
  select coalesce(string_agg(format('%s definer=%s config=%s exec=%s/%s/%s/%s', p.proname, p.prosecdef::text,
                                    array_to_string(p.proconfig, ';'),
                                    has_function_privilege('public', p.oid, 'execute')::text,
                                    has_function_privilege('anon', p.oid, 'execute')::text,
                                    has_function_privilege('authenticated', p.oid, 'execute')::text,
                                    has_function_privilege('service_role', p.oid, 'execute')::text),
                             ' | ' order by p.proname collate "C"), 'missing')
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname in ('enforce_wiki_page_same_space', 'enforce_space_member_in_org')
), 'enforce_space_member_in_org definer=true config=search_path=public exec=false/false/false/false'
   || ' | enforce_wiki_page_same_space definer=true config=search_path=public exec=false/false/false/false');

select test.check('chg_invites_space_org_fk', (
  select coalesce((select format('%s validated=%s', pg_get_constraintdef(c.oid), c.convalidated::text)
                     from pg_constraint c
                    where c.conrelid = 'public.invites'::regclass and c.conname = 'invites_space_org_fkey'), 'missing')
), 'FOREIGN KEY (space_id, org_id) REFERENCES spaces(id, org_id) ON DELETE CASCADE validated=true');

select test.check('chg_mcp_authorize_body', (
  select md5(p.prosrc) from pg_proc p where p.oid = 'public.mcp_authorize(uuid,uuid,uuid,text,text,uuid)'::regprocedure
), :'new_md5');

-- mcp_authorize の DEFINER・search_path・実行権（service_role だけ）は変えない
select test.check('same_mcp_authorize_rights', (
  select format('definer=%s config=%s exec=%s/%s/%s/%s', p.prosecdef::text, array_to_string(p.proconfig, ';'),
                has_function_privilege('public', p.oid, 'execute')::text,
                has_function_privilege('anon', p.oid, 'execute')::text,
                has_function_privilege('authenticated', p.oid, 'execute')::text,
                has_function_privilege('service_role', p.oid, 'execute')::text)
  from pg_proc p where p.oid = 'public.mcp_authorize(uuid,uuid,uuid,text,text,uuid)'::regprocedure
), 'definer=true config=search_path=public exec=false/false/false/true');

-- 既にある行は変わらない
select test.check('same_existing_rows_unchanged', (
  select format('t0=%s invites=%s space_members=%s org_members=%s',
                test.task_wiki(:'T0'),
                (select count(*) from public.invites where org_id = :'O1'),
                (select count(*) from public.space_memberships where space_id in (:'S1', :'S2', :'S3', :'Sd')),
                (select count(*) from public.org_memberships where org_id in (:'O1', :'O2', :'Od')))
), 't0=' || :'W1' || ' invites=3 space_members=8 org_members=8');

-- -----------------------------------------------------------------------------
-- タスクの Wiki ページ: 同じ space のページか null は通り、別の space・別の組織のページは止まる
-- -----------------------------------------------------------------------------
\echo '== tasks.wiki_page_id (service_role = CLI / MCP) =='
begin;
set local role service_role;
select test.check('same_task_same_space_page_ok', test.flow(
  array[format('update public.tasks set wiki_page_id = %L where id = %L', :'W1', :'T0'),
        format('insert into public.tasks(id, org_id, space_id, title, status, created_by, wiki_page_id) values (%L, %L, %L, %L, %L, %L, %L)',
               :'T1', :'O1', :'S1', 't1', 'todo', :'u_ed', :'W1')],
  format('select test.task_wiki(%L) || %L || test.task_wiki(%L)', :'T0', '/', :'T1')), 'ok:' || :'W1' || '/' || :'W1');
select test.check('same_task_null_page_ok', test.flow(
  array[format('update public.tasks set wiki_page_id = null where id = %L', :'T0'),
        format('insert into public.tasks(id, org_id, space_id, title, status, created_by) values (%L, %L, %L, %L, %L, %L)',
               :'T1', :'O1', :'S1', 't1', 'todo', :'u_ed')],
  format('select test.task_wiki(%L) || %L || test.task_wiki(%L)', :'T0', '/', :'T1')), 'ok:null/null');
select test.check('chg_task_other_space_page_rejected', test.flow(
  array[format('update public.tasks set wiki_page_id = %L where id = %L', :'W2', :'T0')],
  format('select test.task_wiki(%L)', :'T0')), 'like:err:P0001:%wiki page must be in the same space%');
select test.check('chg_task_other_org_page_rejected', test.flow(
  array[format('update public.tasks set wiki_page_id = %L where id = %L', :'W3', :'T0')],
  format('select test.task_wiki(%L)', :'T0')), 'like:err:P0001:%wiki page must be in the same space%');
select test.check('chg_task_insert_other_space_page_rejected', test.flow(
  array[format('insert into public.tasks(id, org_id, space_id, title, status, created_by, wiki_page_id) values (%L, %L, %L, %L, %L, %L, %L)',
               :'T1', :'O1', :'S1', 't1', 'todo', :'u_ed', :'W2')],
  format('select test.task_wiki(%L)', :'T1')), 'like:err:P0001:%wiki page must be in the same space%');
commit;

\echo '== tasks.wiki_page_id (authenticated = 画面) =='
begin;
set local role authenticated;
select set_config('request.jwt.claims', :'c_ed', true);
select test.check('same_editor_links_same_space_page', test.flow(
  array[format('update public.tasks set wiki_page_id = null where id = %L', :'T0'),
        format('update public.tasks set wiki_page_id = %L where id = %L', :'W1', :'T0')],
  format('select test.task_wiki(%L)', :'T0')), 'ok:' || :'W1');
select test.check('chg_editor_other_space_page_rejected', test.flow(
  array[format('update public.tasks set wiki_page_id = %L where id = %L', :'W2', :'T0')],
  format('select test.task_wiki(%L)', :'T0')), 'like:err:P0001:%wiki page must be in the same space%');
commit;

-- -----------------------------------------------------------------------------
-- 招待: space と組織の組み合わせが spaces と一致しない行は入らない
-- -----------------------------------------------------------------------------
\echo '== invites =='
begin;
set local role service_role;
select test.check('same_invite_matching_org_ok', test.flow(
  array[format('insert into public.invites(org_id, space_id, email, role, token, expires_at, created_by) values (%L, %L, %L, %L, %L, now() + interval %L, %L)',
               :'O1', :'S1', 'x@example.com', 'client', 'ssi-x', '1 day', :'u_own')],
  format('select count(*)::text from public.invites where token = %L', 'ssi-x')), 'ok:1');
select test.check('chg_invite_other_org_rejected', test.flow(
  array[format('insert into public.invites(org_id, space_id, email, role, token, expires_at, created_by) values (%L, %L, %L, %L, %L, now() + interval %L, %L)',
               :'O2', :'S1', 'x@example.com', 'client', 'ssi-x', '1 day', :'u_own')],
  format('select count(*)::text from public.invites where token = %L', 'ssi-x')), 'like:err:23503:%invites_space_org_fkey%');
select test.check('chg_invite_update_other_org_rejected', test.flow(
  array[format('update public.invites set org_id = %L where token = %L', :'O2', 'ssi-member')],
  format('select org_id::text from public.invites where token = %L', 'ssi-member')), 'like:err:23503:%invites_space_org_fkey%');
commit;

-- -----------------------------------------------------------------------------
-- space のメンバー: その space の組織のメンバーだけが入れる（役割だけの変更は確かめない）
-- -----------------------------------------------------------------------------
\echo '== space_memberships =='
begin;
set local role service_role;
select test.check('same_org_member_joins_space', test.flow(
  array[format('insert into public.space_memberships(space_id, user_id, role) values (%L, %L, %L)', :'S2', :'u_ed', 'editor')],
  format('select test.space_role(%L, %L)', :'S2', :'u_ed')), 'ok:editor');
select test.check('chg_outsider_cannot_join_space', test.flow(
  array[format('insert into public.space_memberships(space_id, user_id, role) values (%L, %L, %L)', :'S1', :'u_out', 'viewer')],
  format('select test.space_role(%L, %L)', :'S1', :'u_out')), 'like:err:P0001:%must be a member of the space organization%');
select test.check('chg_other_org_member_cannot_join_space', test.flow(
  array[format('insert into public.space_memberships(space_id, user_id, role) values (%L, %L, %L)', :'S3', :'u_own', 'viewer')],
  format('select test.space_role(%L, %L)', :'S3', :'u_own')), 'like:err:P0001:%must be a member of the space organization%');
select test.check('chg_member_cannot_move_to_other_org_space', test.flow(
  array[format('update public.space_memberships set space_id = %L where space_id = %L and user_id = %L', :'S3', :'S2', :'u_own')],
  format('select test.space_role(%L, %L)', :'S3', :'u_own')), 'like:err:P0001:%must be a member of the space organization%');
-- 組織のメンバーより先に space に入れる順番は止まる
select test.check('chg_space_before_org_rejected', test.flow(
  array[format('insert into public.space_memberships(space_id, user_id, role) values (%L, %L, %L)', :'S1', :'u_out', 'editor'),
        format('insert into public.org_memberships(org_id, user_id, role) values (%L, %L, %L)', :'O1', :'u_out', 'member')],
  format('select test.space_role(%L, %L)', :'S1', :'u_out')), 'like:err:P0001:%must be a member of the space organization%');
select test.check('same_role_change_ok', test.flow(
  array[format('update public.space_memberships set role = %L where space_id = %L and user_id = %L', 'viewer', :'S1', :'u_ed')],
  format('select test.space_role(%L, %L)', :'S1', :'u_ed')), 'ok:viewer');

-- 招待の受諾（rpc_accept_invite。組織のメンバーを先に入れてから space に入れる）は、どの役割でも通る
select test.check('same_accept_member_invite', test.flow(
  array[format('select public.rpc_accept_invite(%L, %L)', 'ssi-member', :'u_nu1')],
  format('select test.org_space_roles(%L, %L, %L)', :'O1', :'S1', :'u_nu1')), 'ok:member/editor');
select test.check('same_accept_client_invite', test.flow(
  array[format('select public.rpc_accept_invite(%L, %L)', 'ssi-client', :'u_nu2')],
  format('select test.org_space_roles(%L, %L, %L)', :'O1', :'S1', :'u_nu2')), 'ok:client/client');
select test.check('same_accept_vendor_invite', test.flow(
  array[format('select public.rpc_accept_invite(%L, %L)', 'ssi-vendor', :'u_nu3')],
  format('select test.org_space_roles(%L, %L, %L)', :'O1', :'S1', :'u_nu3')), 'ok:client/vendor');
commit;

-- デモの作り直し（scripts/seed-test-data.ts）と同じ順番: 組織のメンバー → space → space のメンバー
select test.check('same_demo_seed_order', test.flow(
  array[format('delete from public.org_memberships where org_id = %L', :'Od'),
        format('insert into public.org_memberships(org_id, user_id, role) values (%L, %L, %L), (%L, %L, %L), (%L, %L, %L)',
               :'Od', :'u_d1', 'owner', :'Od', :'u_d2', 'member', :'Od', :'u_d3', 'client'),
        format('insert into public.spaces(id, org_id, type, name) values (%L, %L, %L, %L) on conflict (id) do update set name = excluded.name',
               :'Sd', :'Od', 'project', 'sd'),
        format('delete from public.space_memberships where space_id = %L', :'Sd'),
        format('insert into public.space_memberships(space_id, user_id, role) values (%L, %L, %L), (%L, %L, %L), (%L, %L, %L)',
               :'Sd', :'u_d1', 'admin', :'Sd', :'u_d2', 'editor', :'Sd', :'u_d3', 'client')],
  format('select count(*)::text from public.space_memberships where space_id = %L', :'Sd')), 'ok:3');
-- --reset のとき: space を消す → 組織のメンバーを消す → 人を消す → 人を作り直してから、上と同じ順番
select test.check('same_demo_reset_order', test.flow(
  array[format('delete from public.spaces where org_id = %L', :'Od'),
        format('delete from public.org_memberships where org_id = %L', :'Od'),
        format('delete from auth.users where id in (%L, %L, %L, %L)', :'u_d1', :'u_d2', :'u_d3', :'u_v1'),
        format('insert into auth.users(id) values (%L), (%L), (%L)', :'u_d1', :'u_d2', :'u_d3'),
        format('delete from public.org_memberships where org_id = %L', :'Od'),
        format('insert into public.org_memberships(org_id, user_id, role) values (%L, %L, %L), (%L, %L, %L), (%L, %L, %L)',
               :'Od', :'u_d1', 'owner', :'Od', :'u_d2', 'member', :'Od', :'u_d3', 'client'),
        format('insert into public.spaces(id, org_id, type, name) values (%L, %L, %L, %L) on conflict (id) do update set name = excluded.name',
               :'Sd', :'Od', 'project', 'sd'),
        format('delete from public.space_memberships where space_id = %L', :'Sd'),
        format('insert into public.space_memberships(space_id, user_id, role) values (%L, %L, %L), (%L, %L, %L), (%L, %L, %L)',
               :'Sd', :'u_d1', 'admin', :'Sd', :'u_d2', 'editor', :'Sd', :'u_d3', 'client')],
  format('select count(*)::text from public.space_memberships where space_id = %L', :'Sd')), 'ok:3');
-- 協力会社（scripts/seed-agency-data.mjs・supabase/seed_agency_test.sql）: 組織に client で入れてから space に vendor で入れる
select test.check('same_vendor_seed_order', test.flow(
  array[format('insert into public.org_memberships(org_id, user_id, role) values (%L, %L, %L) on conflict (org_id, user_id) do nothing',
               :'Od', :'u_v1', 'client'),
        format('delete from public.space_memberships where space_id = %L', :'Sd'),
        format('insert into public.space_memberships(space_id, user_id, role) values (%L, %L, %L), (%L, %L, %L)',
               :'Sd', :'u_d1', 'admin', :'Sd', :'u_v1', 'vendor')],
  format('select string_agg(role, %L order by role) from public.space_memberships where space_id = %L', ',', :'Sd')), 'ok:admin,vendor');

-- -----------------------------------------------------------------------------
-- mcp_authorize: 個人鍵でも、鍵の組織と違う組織の space は止まる。同じ組織・space 鍵は今までどおり
-- -----------------------------------------------------------------------------
\echo '== mcp_authorize =='
begin;
set local role service_role;
select test.check('same_mcp_user_key_same_org_ok', test.val(format(
  'select concat_ws(%L, r->>%L, r->>%L) from (select public.mcp_authorize(%L::uuid, null::uuid, %L::uuid, %L) as r) x',
  ':', 'allowed', 'reason', :'K_user', :'S1', 'read')), 'ok:true:OK');
select test.check('chg_mcp_user_key_other_org_rejected', test.val(format(
  'select concat_ws(%L, r->>%L, r->>%L) from (select public.mcp_authorize(%L::uuid, null::uuid, %L::uuid, %L) as r) x',
  ':', 'allowed', 'reason', :'K_user', :'S3', 'read')), 'ok:false:Space does not belong to the organization');
select test.check('same_mcp_user_key_not_member_rejected', test.val(format(
  'select concat_ws(%L, r->>%L, r->>%L) from (select public.mcp_authorize(%L::uuid, null::uuid, %L::uuid, %L) as r) x',
  ':', 'allowed', 'reason', :'K_user', :'S2', 'read')), 'ok:false:User is not a member of this space');
select test.check('same_mcp_space_key_ok', test.val(format(
  'select concat_ws(%L, r->>%L, r->>%L) from (select public.mcp_authorize(%L::uuid, null::uuid, %L::uuid, %L) as r) x',
  ':', 'allowed', 'reason', :'K_space', :'S1', 'write')), 'ok:true:OK');
select test.check('same_mcp_space_key_other_space_rejected', test.val(format(
  'select concat_ws(%L, r->>%L, r->>%L) from (select public.mcp_authorize(%L::uuid, null::uuid, %L::uuid, %L) as r) x',
  ':', 'allowed', 'reason', :'K_space', :'S2', 'read')), 'ok:false:Space ID does not match API key scope');
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
    raise exception 'SPACE SCOPE INVARIANTS CHECKS FAILED (% failures)', v_fail;
  end if;
end $$;
select 'SPACE SCOPE INVARIANTS CHECKS PASSED' as result;
