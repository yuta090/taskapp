-- =============================================================================
-- 組織の役割と space の役割をそろえる（*_org_space_role_consistency.sql）の挙動検証
-- 前提: run_org_space_role_consistency.sh が _local_bootstrap → Supabase の権限の代役 → migrations（PR-B まで）→
--   org_space_role_consistency_seed.sql → 本 migration（RED=1 のときは本 migration だけ流さない）。
--   データと人物は seed のとおり。
-- CLI / MCP の道具と同じ書き込みは set role service_role（RLS を通らない）。
-- 画面と同じ書き込みは set role authenticated ＋ request.jwt.claims（RLS を通る）。
-- commit の時点の確かめ（遅延の制約トリガー）は、流れの最後の `set constraints all immediate` で起こす
--   （本当の commit で止まることは、ハーネスが別に確かめる）。
--
-- label:
--   chg_*    本 migration で変わるもの（適用前は FAIL・適用後は PASS であるべき）
--   same_*   本 migration で変えないもの（両方で PASS）
-- 出力: PASS[label] / FAIL[label]。最後に FAIL が 0 件なら "ORG SPACE ROLE CONSISTENCY CHECKS PASSED"。
--   1件でもあれば例外で終了する。書き込みはサブトランザクションで実行し、必ず巻き戻す（各 assert は独立）。
-- =============================================================================
set client_min_messages = notice;

\set O1 '00000000-0000-0000-0000-00000000a001'
\set Od '00000000-0000-0000-0000-00000000a009'
\set S1 '00000000-0000-0000-0000-00000000b001'
\set S2 '00000000-0000-0000-0000-00000000b002'
\set SA '00000000-0000-0000-0000-00000000b003'
\set Sd '00000000-0000-0000-0000-00000000b009'
\set u_own '00000000-0000-0000-0000-00000000c001'
\set u_ed '00000000-0000-0000-0000-00000000c002'
\set u_cl '00000000-0000-0000-0000-00000000c003'
\set u_cl2 '00000000-0000-0000-0000-00000000c004'
\set u_ven '00000000-0000-0000-0000-00000000c005'
\set u_nu1 '00000000-0000-0000-0000-00000000c006'
\set u_nu2 '00000000-0000-0000-0000-00000000c007'
\set u_nu3 '00000000-0000-0000-0000-00000000c008'
\set u_d1 '00000000-0000-0000-0000-00000000c011'
\set u_d2 '00000000-0000-0000-0000-00000000c012'
\set u_d3 '00000000-0000-0000-0000-00000000c013'
\set u_v1 '00000000-0000-0000-0000-00000000c014'
\set T1 '00000000-0000-0000-0000-00000000d001'
\set T2 '00000000-0000-0000-0000-00000000d002'
\set c_own '{"sub":"00000000-0000-0000-0000-00000000c001","role":"authenticated"}'
\set c_ed '{"sub":"00000000-0000-0000-0000-00000000c002","role":"authenticated"}'
\set c_cl '{"sub":"00000000-0000-0000-0000-00000000c003","role":"authenticated"}'
\set c_ven '{"sub":"00000000-0000-0000-0000-00000000c005","role":"authenticated"}'
-- 本 migration で作り直す関数の本文の md5
\set md5_enforce 'a09b78e50b94eaef2bb916d9dcd341a0'
\set md5_org '0d54b0e37e0ec3a106631e93ced9b4aa'
\set md5_space '4b1214b97dda33ac8c5faf2376e2be62'

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

-- その人の、組織の役割 / space の役割（行が無ければ -）。RLS に隠されずに読む
create or replace function test.roles(p_org uuid, p_space uuid, p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select om.role from public.org_memberships om where om.org_id = p_org and om.user_id = p_user), '-')
         || '/' || coalesce((select sm.role from public.space_memberships sm where sm.space_id = p_space and sm.user_id = p_user), '-')
$$;

-- 組織 O1 の space の、組織の役割 → space の役割の組み合わせと件数
create or replace function test.combos()
returns text language sql stable security definer set search_path = public as $$
  select string_agg(k || '=' || n, ',' order by k)
    from (select coalesce(om.role, '-') || '->' || sm.role as k, count(*) as n
            from public.space_memberships sm
            join public.spaces s on s.id = sm.space_id
            left join public.org_memberships om on om.org_id = s.org_id and om.user_id = sm.user_id
           where s.org_id = '00000000-0000-0000-0000-00000000a001'
           group by 1) x
$$;

-- 関数を作る migration が「既定の実行権を付けない」ので、補助関数は明示で grant する
grant execute on all functions in schema test to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 形: トリガー・関数・実行権・ポリシー・mcp_authorize（変えない）・既にある行
-- -----------------------------------------------------------------------------
\echo '== shape =='
select test.check('chg_space_trigger_checks_role', (
  select coalesce((select format('%s:%s', t.tgenabled::text,
                                 (pg_get_triggerdef(t.oid) like '%BEFORE INSERT OR UPDATE OF space_id, user_id, role ON public.space_memberships FOR EACH ROW EXECUTE FUNCTION %enforce_space_member_in_org()')::text)
                     from pg_trigger t
                    where t.tgrelid = 'public.space_memberships'::regclass
                      and t.tgname = 'trg_enforce_space_member_in_org' and not t.tgisinternal), 'none')
), 'O:true');

select test.check('chg_org_role_constraint_trigger', (
  select coalesce((select format('%s:deferrable=%s:deferred=%s:%s', t.tgenabled::text, t.tgdeferrable::text, t.tginitdeferred::text,
                                 (pg_get_triggerdef(t.oid) like '%AFTER UPDATE OF role ON public.org_memberships%FOR EACH ROW WHEN ((old.role IS DISTINCT FROM new.role)) EXECUTE FUNCTION %enforce_org_member_role_matches_spaces()')::text)
                     from pg_trigger t
                    where t.tgrelid = 'public.org_memberships'::regclass
                      and t.tgname = 'trg_org_member_role_matches_spaces' and not t.tgisinternal), 'none')
), 'O:deferrable=true:deferred=true:true');

select test.check('chg_functions_rebuilt', (
  select string_agg(format('%s=%s', p.proname, md5(p.prosrc)), ' ' order by p.proname collate "C")
    from pg_proc p
   where p.oid in (to_regprocedure('public.enforce_space_member_in_org()'),
                   to_regprocedure('public.rpc_update_org_member_role(uuid,uuid,text)'),
                   to_regprocedure('public.rpc_update_space_member_role(uuid,uuid,text)'))
), 'enforce_space_member_in_org=' || :'md5_enforce' || ' rpc_update_org_member_role=' || :'md5_org'
   || ' rpc_update_space_member_role=' || :'md5_space');

select test.check('chg_new_trigger_function_shape', (
  select coalesce((select format('definer=%s config=%s exec=%s/%s/%s/%s', p.prosecdef::text, array_to_string(p.proconfig, ';'),
                                 has_function_privilege('public', p.oid, 'execute')::text,
                                 has_function_privilege('anon', p.oid, 'execute')::text,
                                 has_function_privilege('authenticated', p.oid, 'execute')::text,
                                 has_function_privilege('service_role', p.oid, 'execute')::text)
                     from pg_proc p where p.oid = to_regprocedure('public.enforce_org_member_role_matches_spaces()')), 'missing')
), 'definer=true config=search_path=public exec=false/false/false/false');

-- 作り直す関数の DEFINER・search_path・実行権は変えない
select test.check('same_function_rights', (
  select string_agg(format('%s definer=%s config=%s exec=%s/%s/%s/%s', p.proname, p.prosecdef::text,
                           array_to_string(p.proconfig, ';'),
                           has_function_privilege('public', p.oid, 'execute')::text,
                           has_function_privilege('anon', p.oid, 'execute')::text,
                           has_function_privilege('authenticated', p.oid, 'execute')::text,
                           has_function_privilege('service_role', p.oid, 'execute')::text),
                    ' | ' order by p.proname collate "C")
    from pg_proc p
   where p.oid in (to_regprocedure('public.enforce_space_member_in_org()'),
                   to_regprocedure('public.rpc_update_org_member_role(uuid,uuid,text)'),
                   to_regprocedure('public.rpc_update_space_member_role(uuid,uuid,text)'))
), 'enforce_space_member_in_org definer=true config=search_path=public exec=false/false/false/false'
   || ' | rpc_update_org_member_role definer=true config=search_path=public exec=false/false/true/true'
   || ' | rpc_update_space_member_role definer=true config=search_path=public exec=false/false/true/true');

select test.check('chg_task_pricing_policies', (
  select string_agg(format('%s:%s:%s', policyname, coalesce(qual, '-'), coalesce(with_check, '-')), ' | ' order by policyname collate "C")
    from pg_policies
   where schemaname = 'public' and tablename = 'task_pricing' and policyname like 'task\_pricing\_%'
), 'task_pricing_delete_member:app_is_space_internal(space_id, org_id):-'
   || ' | task_pricing_insert_member:-:app_is_space_internal(space_id, org_id)'
   || ' | task_pricing_select_member:app_is_space_internal(space_id, org_id):-'
   || ' | task_pricing_update_member:app_is_space_internal(space_id, org_id):app_is_space_internal(space_id, org_id)');

-- mcp_authorize は変えない（PR-B の本文のまま）
select test.check('same_mcp_authorize_body_unchanged', (
  select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.mcp_authorize(uuid,uuid,uuid,text,text,uuid)')
), '78b4d4465b0c123e17a433e420f53fea');

-- 既にある行は変わらない
select test.check('same_existing_role_combinations', test.combos(),
  'client->client=2,client->vendor=1,member->editor=1,owner->admin=3');

-- -----------------------------------------------------------------------------
-- ①② space の役割は組織の役割で決まる（CLI / MCP の道具と同じ service_role で書く）
-- -----------------------------------------------------------------------------
\echo '== space_memberships (service_role) =='
begin;
set local role service_role;
select test.check('chg_org_client_cannot_become_space_viewer', test.flow(
  array[format('update public.space_memberships set role = %L where space_id = %L and user_id = %L', 'viewer', :'S1', :'u_cl')],
  format('select test.roles(%L, %L, %L)', :'O1', :'S1', :'u_cl')),
  'like:err:P0001:space role viewer is not allowed for organization role client%');
select test.check('chg_org_client_cannot_join_as_editor', test.flow(
  array[format('insert into public.space_memberships(space_id, user_id, role) values (%L, %L, %L)', :'S2', :'u_cl', 'editor')],
  format('select test.roles(%L, %L, %L)', :'O1', :'S2', :'u_cl')),
  'like:err:P0001:space role editor is not allowed for organization role client%');
select test.check('same_org_client_joins_as_client', test.flow(
  array[format('insert into public.space_memberships(space_id, user_id, role) values (%L, %L, %L)', :'S2', :'u_cl', 'client')],
  format('select test.roles(%L, %L, %L)', :'O1', :'S2', :'u_cl')), 'ok:client/client');
select test.check('same_org_client_joins_as_vendor', test.flow(
  array[format('insert into public.space_memberships(space_id, user_id, role) values (%L, %L, %L)', :'S2', :'u_cl', 'vendor')],
  format('select test.roles(%L, %L, %L)', :'O1', :'S2', :'u_cl')), 'ok:client/vendor');
select test.check('chg_internal_cannot_join_as_vendor', test.flow(
  array[format('insert into public.space_memberships(space_id, user_id, role) values (%L, %L, %L)', :'S2', :'u_ed', 'vendor')],
  format('select test.roles(%L, %L, %L)', :'O1', :'S2', :'u_ed')),
  'like:err:P0001:space role vendor is not allowed for organization role member%');
select test.check('chg_internal_cannot_join_as_client', test.flow(
  array[format('insert into public.space_memberships(space_id, user_id, role) values (%L, %L, %L)', :'S2', :'u_ed', 'client')],
  format('select test.roles(%L, %L, %L)', :'O1', :'S2', :'u_ed')),
  'like:err:P0001:space role client is not allowed for organization role member%');
select test.check('chg_internal_cannot_become_space_client', test.flow(
  array[format('update public.space_memberships set role = %L where space_id = %L and user_id = %L', 'client', :'S1', :'u_ed')],
  format('select test.roles(%L, %L, %L)', :'O1', :'S1', :'u_ed')),
  'like:err:P0001:space role client is not allowed for organization role member%');
select test.check('same_internal_joins_as_viewer', test.flow(
  array[format('insert into public.space_memberships(space_id, user_id, role) values (%L, %L, %L)', :'S2', :'u_ed', 'viewer')],
  format('select test.roles(%L, %L, %L)', :'O1', :'S2', :'u_ed')), 'ok:member/viewer');
commit;

-- -----------------------------------------------------------------------------
-- ③ rpc_update_org_member_role: 組織の役割を変えると、space の役割も同じトランザクションでそろう（組織の owner が画面から）
-- -----------------------------------------------------------------------------
\echo '== rpc_update_org_member_role =='
begin;
set local role authenticated;
select set_config('request.jwt.claims', :'c_own', true);
select test.check('chg_org_rpc_client_to_member_aligns_spaces', test.flow(
  array[format('select public.rpc_update_org_member_role(%L, %L, %L)', :'O1', :'u_cl', 'member'), 'set constraints all immediate'],
  format('select test.roles(%L, %L, %L)', :'O1', :'S1', :'u_cl')), 'ok:member/viewer');
select test.check('chg_org_rpc_vendor_to_member_aligns_spaces', test.flow(
  array[format('select public.rpc_update_org_member_role(%L, %L, %L)', :'O1', :'u_ven', 'member'), 'set constraints all immediate'],
  format('select test.roles(%L, %L, %L)', :'O1', :'SA', :'u_ven')), 'ok:member/viewer');
select test.check('same_org_rpc_member_to_client_aligns_spaces', test.flow(
  array[format('select public.rpc_update_org_member_role(%L, %L, %L)', :'O1', :'u_ed', 'client'), 'set constraints all immediate'],
  format('select test.roles(%L, %L, %L)', :'O1', :'S1', :'u_ed')), 'ok:client/client');
select test.check('same_org_rpc_member_to_owner_keeps_spaces', test.flow(
  array[format('select public.rpc_update_org_member_role(%L, %L, %L)', :'O1', :'u_ed', 'owner'), 'set constraints all immediate'],
  format('select test.roles(%L, %L, %L)', :'O1', :'S1', :'u_ed')), 'ok:owner/editor');
commit;

-- -----------------------------------------------------------------------------
-- ④⑤ rpc_update_space_member_role: 組織の役割で持てない役割・代理店モードでない space の vendor は、書く前に断る
-- -----------------------------------------------------------------------------
\echo '== rpc_update_space_member_role =='
begin;
set local role authenticated;
select set_config('request.jwt.claims', :'c_own', true);
select test.check('chg_space_rpc_rejects_internal_role_for_org_client', test.flow(
  array[format('select public.rpc_update_space_member_role(%L, %L, %L)', :'S1', :'u_cl', 'editor')],
  format('select test.roles(%L, %L, %L)', :'O1', :'S1', :'u_cl')), 'like:err:P0001:相手先の人には%');
select test.check('chg_space_rpc_rejects_external_role_for_internal', test.flow(
  array[format('select public.rpc_update_space_member_role(%L, %L, %L)', :'S1', :'u_ed', 'client')],
  format('select test.roles(%L, %L, %L)', :'O1', :'S1', :'u_ed')), 'like:err:P0001:社内のメンバーには%');
select test.check('chg_space_rpc_rejects_vendor_outside_agency_mode', test.flow(
  array[format('select public.rpc_update_space_member_role(%L, %L, %L)', :'S1', :'u_cl', 'vendor')],
  format('select test.roles(%L, %L, %L)', :'O1', :'S1', :'u_cl')), 'like:err:P0001:%代理店モード%');
select test.check('same_space_rpc_internal_change_ok', test.flow(
  array[format('select public.rpc_update_space_member_role(%L, %L, %L)', :'S1', :'u_ed', 'viewer')],
  format('select test.roles(%L, %L, %L)', :'O1', :'S1', :'u_ed')), 'ok:member/viewer');
select test.check('same_space_rpc_vendor_in_agency_space_ok', test.flow(
  array[format('select public.rpc_update_space_member_role(%L, %L, %L)', :'SA', :'u_cl2', 'vendor')],
  format('select test.roles(%L, %L, %L)', :'O1', :'SA', :'u_cl2')), 'ok:client/vendor');
commit;

-- -----------------------------------------------------------------------------
-- ⑥ org_memberships を直接書き換えて space 側を直さないと、commit の時点で止まる（直せば通る）
-- -----------------------------------------------------------------------------
\echo '== org_memberships の直接の書き換え =='
begin;
set local role service_role;
select test.check('chg_org_direct_update_without_space_fix_rejected', test.flow(
  array[format('update public.org_memberships set role = %L where org_id = %L and user_id = %L', 'client', :'O1', :'u_ed'),
        'set constraints all immediate'],
  format('select test.roles(%L, %L, %L)', :'O1', :'S1', :'u_ed')),
  'like:err:P0001:organization role client does not match space roles (editor)%');
select test.check('same_org_direct_update_with_space_fix_ok', test.flow(
  array[format('update public.org_memberships set role = %L where org_id = %L and user_id = %L', 'client', :'O1', :'u_ed'),
        format('update public.space_memberships set role = %L where space_id = %L and user_id = %L', 'client', :'S1', :'u_ed'),
        'set constraints all immediate'],
  format('select test.roles(%L, %L, %L)', :'O1', :'S1', :'u_ed')), 'ok:client/client');
commit;

-- -----------------------------------------------------------------------------
-- 招待の受諾（rpc_accept_invite）の3経路と、seed の組み合わせは今までどおり通る
-- -----------------------------------------------------------------------------
\echo '== invite acceptance / seed combinations =='
begin;
set local role service_role;
select test.check('same_accept_member_invite', test.flow(
  array[format('select public.rpc_accept_invite(%L, %L)', 'rc-member', :'u_nu1'), 'set constraints all immediate'],
  format('select test.roles(%L, %L, %L)', :'O1', :'S1', :'u_nu1')), 'ok:member/editor');
select test.check('same_accept_client_invite', test.flow(
  array[format('select public.rpc_accept_invite(%L, %L)', 'rc-client', :'u_nu2'), 'set constraints all immediate'],
  format('select test.roles(%L, %L, %L)', :'O1', :'S1', :'u_nu2')), 'ok:client/client');
select test.check('same_accept_vendor_invite', test.flow(
  array[format('select public.rpc_accept_invite(%L, %L)', 'rc-vendor', :'u_nu3'), 'set constraints all immediate'],
  format('select test.roles(%L, %L, %L)', :'O1', :'SA', :'u_nu3')), 'ok:client/vendor');
commit;

-- デモの作り直し（scripts/seed-test-data.ts・supabase/seed_comprehensive.sql）と同じ組み合わせ:
--   組織 owner → space admin・member → editor・client → client
select test.check('same_demo_seed_combinations', test.flow(
  array[format('insert into public.org_memberships(org_id, user_id, role) values (%L, %L, %L), (%L, %L, %L), (%L, %L, %L)',
               :'Od', :'u_d1', 'owner', :'Od', :'u_d2', 'member', :'Od', :'u_d3', 'client'),
        format('insert into public.space_memberships(space_id, user_id, role) values (%L, %L, %L), (%L, %L, %L), (%L, %L, %L)',
               :'Sd', :'u_d1', 'admin', :'Sd', :'u_d2', 'editor', :'Sd', :'u_d3', 'client'),
        'set constraints all immediate'],
  format('select string_agg(test.roles(%L, %L, u), %L order by u) from unnest(array[%L, %L, %L]::uuid[]) u',
         :'Od', :'Sd', ',', :'u_d1', :'u_d2', :'u_d3')), 'ok:owner/admin,member/editor,client/client');
-- 協力会社（scripts/seed-agency-data.mjs・supabase/seed_agency_test.sql）: 組織 client → space vendor
select test.check('same_vendor_seed_combination', test.flow(
  array[format('insert into public.org_memberships(org_id, user_id, role) values (%L, %L, %L)', :'Od', :'u_v1', 'client'),
        format('insert into public.space_memberships(space_id, user_id, role) values (%L, %L, %L)', :'Sd', :'u_v1', 'vendor'),
        'set constraints all immediate'],
  format('select test.roles(%L, %L, %L)', :'Od', :'Sd', :'u_v1')), 'ok:client/vendor');

-- -----------------------------------------------------------------------------
-- task_pricing: 社内の admin / editor は読み書きでき、組織 client（space client / vendor）は読めない
-- -----------------------------------------------------------------------------
\echo '== task_pricing =='
begin;
set local role authenticated;
select set_config('request.jwt.claims', :'c_own', true);
select test.check('same_admin_reads_pricing', test.flow(array[]::text[],
  format('select count(*)::text from public.task_pricing where task_id = %L', :'T1')), 'ok:1');
select set_config('request.jwt.claims', :'c_ed', true);
select test.check('same_editor_writes_pricing', test.flow(
  array[format('update public.task_pricing set cost_hours = 2 where task_id = %L', :'T1')],
  format('select cost_hours::text from public.task_pricing where task_id = %L', :'T1')), 'ok:2.00');
select set_config('request.jwt.claims', :'c_cl', true);
select test.check('same_org_client_cannot_read_pricing', test.flow(array[]::text[],
  format('select count(*)::text from public.task_pricing where task_id = %L', :'T1')), 'ok:0');
select set_config('request.jwt.claims', :'c_ven', true);
select test.check('same_vendor_cannot_read_pricing', test.flow(array[]::text[],
  format('select count(*)::text from public.task_pricing where task_id = %L', :'T2')), 'ok:0');
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
    raise exception 'ORG SPACE ROLE CONSISTENCY CHECKS FAILED (% failures)', v_fail;
  end if;
end $$;
select 'ORG SPACE ROLE CONSISTENCY CHECKS PASSED' as result;
