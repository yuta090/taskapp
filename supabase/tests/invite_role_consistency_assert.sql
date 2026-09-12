-- =============================================================================
-- 招待は組織の役割と合う種類だけ（*_invite_role_consistency.sql）の挙動検証
-- 前提: run_invite_role_consistency.sh が _local_bootstrap → Supabase の権限の代役 → migrations →
--   invite_role_consistency_seed.sql → 本 migration（RED=1 のときは本 migration だけ流さない）。
--   データと人物は seed のとおり。
-- 書き込みはサブトランザクションで実行し、必ず巻き戻す（各 assert は独立）。
-- 画面から呼ぶ rpc_create_invite は set role authenticated ＋ request.jwt.claims で。サーバーは set role service_role。
--
-- 断るときの符号:
--   IRC01 invite_org_role_conflict / IRC02 invite_pending_kind_conflict / IRC03 invite_vendor_requires_agency_mode
--   （rpc_create_invite の 'already a member'・'Invalid role' は今までどおり P0001）
--
-- label:
--   chg_*    本 migration で変わるもの（適用前は FAIL・適用後は PASS であるべき）
--   same_*   本 migration で変えないもの（両方で PASS）
-- 出力: PASS[label] / FAIL[label]。最後に FAIL が 0 件なら "INVITE ROLE CHECKS PASSED"。
--   1件でもあれば例外で終了する。
-- =============================================================================
set client_min_messages = notice;

\set O1 '00000000-0000-0000-0000-00000000a001'
\set O2 '00000000-0000-0000-0000-00000000a002'
\set S1 '00000000-0000-0000-0000-00000000b001'
\set S2 '00000000-0000-0000-0000-00000000b002'
\set S3 '00000000-0000-0000-0000-00000000b003'
\set u_own '00000000-0000-0000-0000-00000000c001'
\set u_mem '00000000-0000-0000-0000-00000000c002'
\set u_ext '00000000-0000-0000-0000-00000000c003'
\set P1 '00000000-0000-0000-0000-00000000e001'
\set P3 '00000000-0000-0000-0000-00000000e004'
\set A1 '00000000-0000-0000-0000-00000000e006'
\set c_own '{"sub":"00000000-0000-0000-0000-00000000c001","role":"authenticated"}'
\set conflict_org 'like:err:IRC01:invite_org_role_conflict%'
\set conflict_pending 'like:err:IRC02:invite_pending_kind_conflict%'
\set conflict_vendor 'like:err:IRC03:invite_vendor_requires_agency_mode%'

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

-- 招待の数（RLS と列の権限に関係なく数える）
create or replace function test.invites(p_email text)
returns text language sql stable security definer set search_path = public as $$
  select count(*)::text from public.invites where lower(email) = lower(p_email)
$$;

-- 招待を作る（postgres で入れる。列は画面・道具と同じ組み合わせ）
create or replace function test.insert_sql(p_org uuid, p_space uuid, p_email text, p_role text)
returns text language sql immutable as $$
  select format('insert into public.invites(org_id, space_id, email, role, token, expires_at, created_by) '
                'values (%L, %L, %L, %L, %L, now() + interval ''30 days'', %L)',
                p_org, p_space, p_email, p_role, 'irc-' || md5(p_email || p_role || p_space::text),
                '00000000-0000-0000-0000-00000000c001')
$$;

-- 「あとから組織に入った人」を作る（auth.users は postgres でしか書けないので definer で）
create or replace function test.add_org_member(p_user uuid, p_email text, p_org uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into auth.users(id, email) values (p_user, p_email);
  insert into public.org_memberships(org_id, user_id, role) values (p_org, p_user, p_role);
end $$;

-- 関数を作る migration が「既定の実行権を付けない」ので、補助関数は明示で grant する
grant execute on all functions in schema test to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 形
-- -----------------------------------------------------------------------------
\echo '== shape =='
select test.check('chg_trigger_shape', coalesce((
  select format('%s:%s', t.tgenabled::text,
                (pg_get_triggerdef(t.oid) like '%BEFORE INSERT OR UPDATE OF org_id, space_id, email, role, token, expires_at'
                                               ' ON public.invites FOR EACH ROW EXECUTE FUNCTION %enforce_invite_role_consistency()')::text)
    from pg_trigger t
   where t.tgrelid = 'public.invites'::regclass and t.tgname = 'trg_enforce_invite_role_consistency' and not t.tgisinternal
), 'missing'), 'O:true');

select test.check('chg_trigger_function_rights', coalesce((
  select format('definer=%s config=%s exec=%s/%s/%s/%s', p.prosecdef::text, array_to_string(p.proconfig, ';'),
                has_function_privilege('public', p.oid, 'execute')::text,
                has_function_privilege('anon', p.oid, 'execute')::text,
                has_function_privilege('authenticated', p.oid, 'execute')::text,
                has_function_privilege('service_role', p.oid, 'execute')::text)
    from pg_proc p where p.oid = to_regprocedure('public.enforce_invite_role_consistency()')
), 'missing'), 'definer=true config=search_path=public exec=false/false/false/false');

-- rpc_create_invite: 「既にメンバー」の確認が使い回しより前・使い回しは同じ役割だけ
select test.check('chg_rpc_create_invite_body', (
  select format('%s/%s',
                (position('already a member' in p.prosrc) < position('Idempotent resend' in p.prosrc))::text,
                (p.prosrc like '%and role = p_role%')::text)
    from pg_proc p where p.oid = to_regprocedure('public.rpc_create_invite(uuid,uuid,text,text,uuid)')
), 'true/true');

select test.check('same_rpc_create_invite_rights', (
  select format('definer=%s config=%s exec=%s/%s/%s/%s', p.prosecdef::text, array_to_string(p.proconfig, ';'),
                has_function_privilege('public', p.oid, 'execute')::text,
                has_function_privilege('anon', p.oid, 'execute')::text,
                has_function_privilege('authenticated', p.oid, 'execute')::text,
                has_function_privilege('service_role', p.oid, 'execute')::text)
    from pg_proc p where p.oid = to_regprocedure('public.rpc_create_invite(uuid,uuid,text,text,uuid)')
), 'definer=true config=search_path=public exec=false/false/true/true');

-- -----------------------------------------------------------------------------
-- 招待を作る（サーバー・postgres）
-- -----------------------------------------------------------------------------
\echo '== insert =='
select test.check('same_insert_new_person_member', test.flow(
  array[test.insert_sql(:'O1', :'S1', 'new1@example.com', 'member')],
  format('select test.invites(%L)', 'new1@example.com')), 'ok:1');
select test.check('same_insert_new_person_client', test.flow(
  array[test.insert_sql(:'O1', :'S1', 'new2@client.example', 'client')],
  format('select test.invites(%L)', 'new2@client.example')), 'ok:1');

-- すでに組織にいる人: 種類が合わなければ断る（合えば通る）
select test.check('chg_insert_client_for_internal_member_refused', test.flow(
  array[test.insert_sql(:'O1', :'S1', 'mem@example.com', 'client')],
  format('select test.invites(%L)', 'mem@example.com')), :'conflict_org');
select test.check('chg_insert_member_for_org_client_refused', test.flow(
  array[test.insert_sql(:'O1', :'S1', 'ext@client.example', 'member')],
  format('select test.invites(%L)', 'ext@client.example')), :'conflict_org');
select test.check('chg_insert_upper_case_email_refused', test.flow(
  array[test.insert_sql(:'O1', :'S1', 'MEM@EXAMPLE.COM', 'client')],
  format('select test.invites(%L)', 'mem@example.com')), :'conflict_org');
select test.check('same_insert_client_for_org_client', test.flow(
  array[test.insert_sql(:'O1', :'S2', 'ext@client.example', 'client')],
  format('select test.invites(%L)', 'ext@client.example')), 'ok:2');
select test.check('same_insert_member_for_internal_member', test.flow(
  array[test.insert_sql(:'O1', :'S2', 'mem@example.com', 'member')],
  format('select test.invites(%L)', 'mem@example.com')), 'ok:1');
select test.check('same_insert_account_without_org', test.flow(
  array[test.insert_sql(:'O1', :'S1', 'acc@example.com', 'client')],
  format('select test.invites(%L)', 'acc@example.com')), 'ok:1');

-- 種類の違う承諾待ちがあれば断る（同じ種類・期限切れ・別の組織なら通る）
select test.check('chg_insert_other_kind_pending_refused', test.flow(
  array[test.insert_sql(:'O1', :'S2', 'np1@example.com', 'client')],
  format('select test.invites(%L)', 'np1@example.com')), :'conflict_pending');
select test.check('same_insert_same_kind_pending_other_space', test.flow(
  array[test.insert_sql(:'O1', :'S2', 'np1@example.com', 'member')],
  format('select test.invites(%L)', 'np1@example.com')), 'ok:2');
select test.check('same_insert_other_org_other_kind', test.flow(
  array[test.insert_sql(:'O2', :'S3', 'np1@example.com', 'client')],
  format('select test.invites(%L)', 'np1@example.com')), 'ok:2');
select test.check('same_insert_after_expired_other_kind', test.flow(
  array[test.insert_sql(:'O1', :'S1', 'np3@example.com', 'member')],
  format('select test.invites(%L)', 'np3@example.com')), 'ok:2');

-- 協力会社（vendor）の招待は代理店モードの space だけ
select test.check('chg_insert_vendor_without_agency_mode_refused', test.flow(
  array[test.insert_sql(:'O1', :'S1', 'ven1@vendor.example', 'vendor')],
  format('select test.invites(%L)', 'ven1@vendor.example')), :'conflict_vendor');
select test.check('same_insert_vendor_with_agency_mode', test.flow(
  array[test.insert_sql(:'O1', :'S2', 'ven2@vendor.example', 'vendor')],
  format('select test.invites(%L)', 'ven2@vendor.example')), 'ok:1');

-- まとめて作る経路: 1行でも合わなければ全部入らない
select test.check('chg_bulk_insert_with_one_conflict_refused', test.flow(
  array[format('insert into public.invites(org_id, space_id, email, role, token, expires_at, created_by) values '
               '(%L, %L, %L, %L, %L, now() + interval ''30 days'', %L), (%L, %L, %L, %L, %L, now() + interval ''30 days'', %L)',
               :'O1', :'S1', 'bulk1@client.example', 'client', 'irc-b1', :'u_own',
               :'O1', :'S1', 'mem@example.com', 'client', 'irc-b2', :'u_own')],
  format('select test.invites(%L)', 'bulk1@client.example')), :'conflict_org');

-- -----------------------------------------------------------------------------
-- 招待を書き換える（再送・承諾・期限切れ・取り消し）
-- -----------------------------------------------------------------------------
\echo '== update / delete =='
-- 再送（期限を延ばす）: その間に組織へ合わない役割で入っていたら断る
select test.check('chg_resend_after_joining_as_other_kind_refused', test.flow(
  array[format('select test.add_org_member(%L, %L, %L, %L)', '00000000-0000-0000-0000-00000000c101', 'late@example.com', :'O1', 'client'),
        format('update public.invites set expires_at = now() + interval ''7 days'' where id = %L', :'P3')],
  format('select test.invites(%L)', 'late@example.com')), :'conflict_org');
select test.check('same_resend_pending_invite', test.flow(
  array[format('update public.invites set expires_at = now() + interval ''7 days'' where id = %L', :'P1')],
  format('select (expires_at > now() + interval ''6 days'')::text from public.invites where id = %L', :'P1')), 'ok:true');
select test.check('same_accept_marks_accepted', test.flow(
  array[format('update public.invites set accepted_at = now() where id = %L', :'P1')],
  format('select (accepted_at is not null)::text from public.invites where id = %L', :'P1')), 'ok:true');
select test.check('same_expire_invite', test.flow(
  array[format('update public.invites set expires_at = now() - interval ''1 minute'' where id = %L', :'P1')],
  format('select (expires_at < now())::text from public.invites where id = %L', :'P1')), 'ok:true');
select test.check('same_update_invitee_name', test.flow(
  array[format('update public.invites set invitee_name = %L where id = %L', 'n', :'P1')],
  format('select invitee_name from public.invites where id = %L', :'P1')), 'ok:n');
-- 承諾済みの招待は確かめない（種類が合わない行でも期限を延ばせる）
select test.check('same_resend_accepted_invite', test.flow(
  array[format('update public.invites set expires_at = now() + interval ''7 days'' where id = %L', :'A1')],
  format('select (expires_at > now() + interval ''6 days'')::text from public.invites where id = %L', :'A1')), 'ok:true');
-- 取り消し（行を消す）は今までどおり
select test.check('same_delete_invite', test.flow(
  array[format('delete from public.invites where id = %L', :'P1')],
  format('select test.invites(%L)', 'np1@example.com')), 'ok:0');

-- -----------------------------------------------------------------------------
-- サーバー（service role）の書き込みにも効く
-- -----------------------------------------------------------------------------
\echo '== service role =='
begin;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select test.check('chg_service_role_insert_refused', test.flow(
  array[test.insert_sql(:'O1', :'S1', 'mem@example.com', 'client')],
  format('select test.invites(%L)', 'mem@example.com')), :'conflict_org');
select test.check('same_service_role_insert_new_person', test.flow(
  array[test.insert_sql(:'O1', :'S1', 'svc1@client.example', 'client')],
  format('select test.invites(%L)', 'svc1@client.example')), 'ok:1');
commit;

-- -----------------------------------------------------------------------------
-- 画面の rpc_create_invite（O1 の owner として呼ぶ）
-- -----------------------------------------------------------------------------
\echo '== rpc_create_invite =='
begin;
set local role authenticated;
select set_config('request.jwt.claims', :'c_own', true);
select test.check('same_rpc_create_new_person', test.flow(
  array[format('select public.rpc_create_invite(%L, %L, %L, %L, %L)', :'O1', :'S1', 'rp1@example.com', 'member', :'u_own')],
  format('select test.invites(%L)', 'rp1@example.com')), 'ok:1');
-- 同じ役割の承諾待ちは使い回す（同じ招待の期限が延びる）
select test.check('same_rpc_reuse_same_role', test.val(format(
  'select ((public.rpc_create_invite(%L, %L, %L, %L, %L)->>''invite_id'') = %L)::text',
  :'O1', :'S1', 'np1@example.com', 'member', :'u_own', :'P1')), 'ok:true');
-- 役割が違う承諾待ちがあるときは断る（同じ space・別の space のどちらでも）
select test.check('chg_rpc_other_kind_same_space_refused', test.val(format(
  'select public.rpc_create_invite(%L, %L, %L, %L, %L)::text', :'O1', :'S1', 'np1@example.com', 'client', :'u_own')),
  :'conflict_pending');
select test.check('chg_rpc_other_kind_other_space_refused', test.val(format(
  'select public.rpc_create_invite(%L, %L, %L, %L, %L)::text', :'O1', :'S2', 'np1@example.com', 'client', :'u_own')),
  :'conflict_pending');
-- 「既にメンバー」の確認は使い回しより前（承諾待ちの招待があっても、参加済みなら断る）
select test.check('chg_rpc_already_member_before_reuse', test.flow(
  array[format('select test.add_org_member(%L, %L, %L, %L)', '00000000-0000-0000-0000-00000000c102', 'joined@example.com', :'O1', 'member'),
        format('select public.rpc_create_invite(%L, %L, %L, %L, %L)', :'O1', :'S1', 'joined@example.com', 'member', :'u_own')],
  format('select test.invites(%L)', 'joined@example.com')), 'like:err:P0001:already a member%');
select test.check('same_rpc_already_member', test.val(format(
  'select public.rpc_create_invite(%L, %L, %L, %L, %L)::text', :'O1', :'S2', 'mem@example.com', 'member', :'u_own')),
  'like:err:P0001:already a member%');
select test.check('same_rpc_invalid_role_vendor', test.val(format(
  'select public.rpc_create_invite(%L, %L, %L, %L, %L)::text', :'O1', :'S2', 'ven3@vendor.example', 'vendor', :'u_own')),
  'like:err:P0001:Invalid role: vendor%');
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
    raise exception 'INVITE ROLE CHECKS FAILED (% failures)', v_fail;
  end if;
end $$;
select 'INVITE ROLE CHECKS PASSED' as result;
