-- =============================================================================
-- 「誰がやったか」を受け取る形の RPC（*_mcp_rpc_as.sql）の挙動検証
-- 前提: run_mcp_rpc_as.sh が _local_bootstrap → Supabase の権限の代役 → migrations → mcp_rpc_as_seed.sql →
--   本 migration（RED=1 のときは本 migration だけ流さない）。データと人物は seed のとおり。
-- 画面の呼び方は set role authenticated ＋ request.jwt.claims（auth.uid() = その人）。
-- 道具の呼び方は set role service_role（auth.uid() は空）で rpc_xxx_as(p_actor = その人, …)。
--
-- 7本それぞれ、同じ人・同じ引数で「画面の関数」と「道具用の関数」を呼び、返り値と、書き込まれうる表の全行
-- （呼ぶ前に無かった ID は NEW に置き換える）が同じであることを確かめる。どちらも巻き戻すので各確認は独立。
--
-- label:
--   chg_*    本 migration で変わるもの（適用前は FAIL・適用後は PASS であるべき）
--   same_*   本 migration で変えないもの（両方で PASS）
-- 出力: PASS[label] / FAIL[label]。最後に FAIL が 0 件なら "MCP RPC AS CHECKS PASSED"。1件でもあれば例外で終了する。
-- =============================================================================
set client_min_messages = notice;

\set O1 '00000000-0000-0000-0000-00000000a001'
\set S1 '00000000-0000-0000-0000-00000000b001'
\set P1 '00000000-0000-0000-0000-00000000b002'
\set u_adm '00000000-0000-0000-0000-00000000c001'
\set u_ed '00000000-0000-0000-0000-00000000c002'
\set u_ed2 '00000000-0000-0000-0000-00000000c003'
\set u_vw '00000000-0000-0000-0000-00000000c004'
\set u_cli '00000000-0000-0000-0000-00000000c005'
\set u_nom '00000000-0000-0000-0000-00000000c006'
\set u_out '00000000-0000-0000-0000-00000000c007'
\set u_per '00000000-0000-0000-0000-00000000c008'
\set T_ball '00000000-0000-0000-0000-00000000d001'
\set T_open '00000000-0000-0000-0000-00000000d002'
\set T_appr '00000000-0000-0000-0000-00000000d003'
\set T_blk '00000000-0000-0000-0000-00000000d004'
\set T_per '00000000-0000-0000-0000-00000000d005'
\set MT_pl '00000000-0000-0000-0000-00000000e001'
\set MT_ip '00000000-0000-0000-0000-00000000e002'
\set PR1 '00000000-0000-0000-0000-00000000f001'
\set SL1 '00000000-0000-0000-0000-00000000f101'
\set SL2 '00000000-0000-0000-0000-00000000f102'

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
    raise notice 'PASS[%]: %', p_label, left(p_got, 300);
  else
    raise notice 'FAIL[%]: got %, want %', p_label, coalesce(left(p_got, 600), 'NULL'), p_want;
  end if;
end $$;

-- 呼んだ人の権限で SQL を1つ流し、値を返して必ず巻き戻す（ok:<値> / err:<SQLSTATE>:<メッセージ>）
create or replace function test.val(p_sql text)
returns text language plpgsql security invoker as $$
declare v text; v_state text; v_detail text; v_msg text;
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

-- 7本が書き込みうる表の全行を「表名 行の JSON」の行にして返す（連番の既定値の列は除く）。definer: 全行を見る
create or replace function test.snapshot()
returns text language plpgsql security definer set search_path = test, public as $$
declare t text; v text; acc text := ''; v_skip text[];
begin
  foreach t in array array['tasks', 'task_owners', 'task_events', 'notifications', 'reviews', 'review_approvals',
                           'meetings', 'meeting_participants', 'scheduling_proposals'] loop
    select coalesce(array_agg(c.column_name::text), '{}') into v_skip
      from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = t
       and (c.column_default like 'nextval(%' or c.is_identity = 'YES');
    execute format('select coalesce(string_agg(%L || '' '' || (to_jsonb(x) - $1)::text, E''\n''), '''') from public.%I x', t, t)
      into v using v_skip;
    acc := acc || v || E'\n';
  end loop;
  return acc;
end $$;

-- 呼ぶ前（p_base）に無かった uuid を NEW に置き換える
create or replace function test.new_ids_out(p_text text, p_base text)
returns text language plpgsql as $$
declare u text; r text := p_text;
begin
  for u in select distinct m[1]
             from regexp_matches(p_text, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', 'g') m loop
    if position(u in p_base) = 0 then r := replace(r, u, 'NEW'); end if;
  end loop;
  return r;
end $$;

create or replace function test.sorted(p_text text)
returns text language sql as $$
  select coalesce(string_agg(l, E'\n' order by l), '') from unnest(string_to_array(p_text, E'\n')) l where l <> ''
$$;

-- 呼んだ人の権限で p_call を流し、1行目に返り値、続けて表の全行を返して、必ず巻き戻す
--   ok:result <返り値>\n<表の行…> / err:<SQLSTATE>:<メッセージ>
create or replace function test.effects(p_call text)
returns text language plpgsql security invoker as $$
declare v_base text; v_res text; v_state text; v_detail text; v_msg text;
begin
  v_base := test.snapshot();
  begin
    execute p_call into v_res;
    raise exception 'test_rollback' using errcode = 'TR001',
      detail = test.new_ids_out('result ' || coalesce(v_res, 'NULL'), v_base) || E'\n'
               || test.sorted(test.new_ids_out(test.snapshot(), v_base));
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail, v_msg = message_text;
    if v_state = 'TR001' then return 'ok:' || v_detail; end if;
    return 'err:' || v_state || ':' || v_msg;
  end;
end $$;

-- 役割を切り替えて p_call を流す（authenticated は p_actor のセッション・service_role は auth.uid() が空）
create or replace function test.one(p_role text, p_actor uuid, p_call text)
returns text language plpgsql security invoker as $$
declare v text;
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims',
    case when p_role = 'service_role' then '{"role":"service_role"}'
         when p_actor is null then '{"role":"anon"}'
         else json_build_object('sub', p_actor, 'role', p_role)::text end, true);
  v := test.effects(p_call);
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v;
end $$;

-- 呼び方（k = 呼び方の名前・fn = 関数の名前の rpc_ と _as を除いた所・args = p_actor の後ろの引数）
create table test.calls (k text primary key, fn text not null, args text not null);
insert into test.calls values
  ('pass_ball', 'pass_ball', format('%L::uuid, %L, %L::uuid[], %L::uuid[], %L, null',
     :'T_ball', 'client', '{' || :'u_cli' || '}', '{' || :'u_ed2' || '}', 'r')),
  ('pass_ball_per', 'pass_ball', format('%L::uuid, %L, %L::uuid[], %L::uuid[], %L, null',
     :'T_per', 'internal', '{}', '{' || :'u_per' || '}', 'r')),
  ('meeting_start', 'meeting_start', format('%L::uuid', :'MT_pl')),
  ('meeting_end', 'meeting_end', format('%L::uuid', :'MT_ip')),
  ('review_open', 'review_open', format('%L::uuid, %L::uuid[], null', :'T_open', '{' || :'u_ed2' || ',' || :'u_adm' || '}')),
  ('review_open_badrev', 'review_open', format('%L::uuid, %L::uuid[], null', :'T_open', '{' || :'u_vw' || '}')),
  ('review_approve', 'review_approve', format('%L::uuid, null', :'T_appr')),
  ('review_block', 'review_block', format('%L::uuid, %L, null', :'T_blk', 'x')),
  ('confirm_proposal_slot', 'confirm_proposal_slot', format('%L::uuid, %L::uuid', :'PR1', :'SL1')),
  ('confirm_sl2', 'confirm_proposal_slot', format('%L::uuid, %L::uuid', :'PR1', :'SL2'));

create or replace function test.shell_call(p_k text)
returns text language sql stable security definer set search_path = test, public as $$
  select format('select public.rpc_%s(%s)::text', fn, args) from test.calls where k = p_k
$$;
create or replace function test.as_call(p_k text, p_actor uuid)
returns text language sql stable security definer set search_path = test, public as $$
  select format('select public.rpc_%s_as(%s::uuid, %s)::text', fn, quote_nullable(p_actor), args) from test.calls where k = p_k
$$;

-- 画面の関数と道具用の関数の結果が同じで、期待どおりの形（p_want は1行目に対して）であること
create or replace function test.parity(p_label text, p_shell text, p_as text, p_want text)
returns void language plpgsql security definer set search_path = test, public as $$
declare la text[]; lb text[]; i int; v_got text;
begin
  if p_shell is not distinct from p_as then
    v_got := split_part(p_shell, E'\n', 1);
  else
    la := string_to_array(p_shell, E'\n'); lb := string_to_array(p_as, E'\n');
    for i in 1..greatest(coalesce(array_length(la, 1), 0), coalesce(array_length(lb, 1), 0)) loop
      if la[i] is distinct from lb[i] then
        v_got := format('differs at line %s: shell=%s | as=%s', i,
                        left(coalesce(la[i], '<none>'), 240), left(coalesce(lb[i], '<none>'), 240));
        exit;
      end if;
    end loop;
  end if;
  perform test.check(p_label, v_got, p_want);
end $$;

-- 同じ人で画面の関数（authenticated）と道具用の関数（service_role）を呼んで比べる
--   same_<label>_shell: 画面の関数の結果が今までどおり / chg_<label>_as_matches_shell: 道具用の関数が同じ結果
create or replace function test.pair(p_label text, p_k text, p_actor uuid, p_want text)
returns void language plpgsql security invoker as $$
declare v_shell text; v_as text;
begin
  v_shell := test.one('authenticated', p_actor, test.shell_call(p_k));
  v_as := test.one('service_role', null, test.as_call(p_k, p_actor));
  perform test.check('same_' || p_label || '_shell', split_part(v_shell, E'\n', 1), p_want);
  perform test.parity('chg_' || p_label || '_as_matches_shell', v_shell, v_as, p_want);
end $$;

-- 関数の形（k・画面の関数・道具用・本体の型の並び）
create table test.fns (k text primary key, shell_sig text, as_sig text, impl_sig text);
insert into test.fns values
  ('pass_ball', 'public.rpc_pass_ball(uuid,text,uuid[],uuid[],text,uuid)',
   'public.rpc_pass_ball_as(uuid,uuid,text,uuid[],uuid[],text,uuid)', 'public._pass_ball_impl(uuid,uuid,text,uuid[],uuid[],text,uuid)'),
  ('meeting_start', 'public.rpc_meeting_start(uuid)', 'public.rpc_meeting_start_as(uuid,uuid)', 'public._meeting_start_impl(uuid,uuid)'),
  ('meeting_end', 'public.rpc_meeting_end(uuid)', 'public.rpc_meeting_end_as(uuid,uuid)', 'public._meeting_end_impl(uuid,uuid)'),
  ('review_open', 'public.rpc_review_open(uuid,uuid[],uuid)', 'public.rpc_review_open_as(uuid,uuid,uuid[],uuid)',
   'public._review_open_impl(uuid,uuid,uuid[],uuid)'),
  ('review_approve', 'public.rpc_review_approve(uuid,uuid)', 'public.rpc_review_approve_as(uuid,uuid,uuid)',
   'public._review_approve_impl(uuid,uuid,uuid)'),
  ('review_block', 'public.rpc_review_block(uuid,text,uuid)', 'public.rpc_review_block_as(uuid,uuid,text,uuid)',
   'public._review_block_impl(uuid,uuid,text,uuid)'),
  ('confirm_proposal_slot', 'public.rpc_confirm_proposal_slot(uuid,uuid)', 'public.rpc_confirm_proposal_slot_as(uuid,uuid,uuid)',
   'public._confirm_proposal_slot_impl(uuid,uuid,uuid)');

create or replace function test.rights(p_sig text)
returns text language sql stable as $$
  select coalesce((
    select format('public=%s anon=%s authenticated=%s service_role=%s definer=%s config=%s',
                  has_function_privilege('public', p.oid, 'execute')::text, has_function_privilege('anon', p.oid, 'execute')::text,
                  has_function_privilege('authenticated', p.oid, 'execute')::text,
                  has_function_privilege('service_role', p.oid, 'execute')::text,
                  p.prosecdef::text, array_to_string(p.proconfig, ';'))
      from pg_proc p where p.oid = to_regprocedure(p_sig)), 'missing')
$$;

-- 役割を切り替えて、道具用（as）か本体（impl）の7つを引数すべて null で呼び、SQLSTATE を並べる
--   （実行権の確かめは本文より先なので、呼べなければ 42501）
create or replace function test.try_calls(p_role text, p_which text)
returns text language plpgsql security invoker as $$
declare r record; v_sig text; v_n int; v_res text; acc text := '';
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', format('{"role":"%s"}', p_role), true);
  for r in select * from test.fns order by k loop
    v_sig := case p_which when 'as' then r.as_sig else r.impl_sig end;
    v_n := array_length(string_to_array(substring(v_sig from '\((.*)\)'), ','), 1);
    v_res := test.val(format('select %s(%s)::text', split_part(v_sig, '(', 1),
                             array_to_string(array_fill('null'::text, array[v_n]), ', ')));
    acc := acc || r.k || '=' || split_part(v_res, ':', 2) || ' ';
  end loop;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return trim(acc);
end $$;

-- app_can_write_space（呼んだ人で判定）と _actor_can_write_space（p_actor で判定）が、人と space の組ごとに同じ
create or replace function test.helper_parity(p_users uuid[], p_spaces uuid[])
returns text language plpgsql as $$
declare u uuid; s uuid; o uuid; a boolean; b boolean; bad text := ''; n int := 0;
begin
  foreach u in array p_users loop
    perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
    foreach s in array p_spaces loop
      select org_id into o from public.spaces where id = s;
      a := public.app_can_write_space(s, o);
      begin
        execute 'select public._actor_can_write_space($1, $2, $3)' into b using u, s, o;
      exception when others then
        return 'missing: ' || sqlerrm;
      end;
      n := n + 1;
      if a is distinct from b then bad := bad || format(' %s/%s:%s<>%s', u, s, a, b); end if;
    end loop;
  end loop;
  perform set_config('request.jwt.claims', '', true);
  return case when bad = '' then format('same (%s pairs)', n) else 'diff:' || bad end;
end $$;

-- 関数を作る migration が「既定の実行権を付けない」ので、補助関数は明示で grant する
grant execute on all functions in schema test to anon, authenticated, service_role;
grant select on all tables in schema test to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 形と実行権
-- -----------------------------------------------------------------------------
\echo '== shape and rights =='
select test.check('same_shell_rights',
  (select string_agg(k || ': ' || test.rights(shell_sig), ' | ' order by k) from test.fns),
  (select string_agg(k || ': public=false anon=false authenticated=true service_role=true definer=true config=search_path=public', ' | ' order by k) from test.fns));
select test.check('chg_as_rights',
  (select string_agg(k || ': ' || test.rights(as_sig), ' | ' order by k) from test.fns),
  (select string_agg(k || ': public=false anon=false authenticated=false service_role=true definer=true config=search_path=public', ' | ' order by k) from test.fns));
select test.check('chg_impl_rights',
  (select string_agg(k || ': ' || test.rights(impl_sig), ' | ' order by k) from test.fns),
  (select string_agg(k || ': public=false anon=false authenticated=false service_role=false definer=true config=search_path=public', ' | ' order by k) from test.fns));
select test.check('chg_helper_rights', test.rights('public._actor_can_write_space(uuid,uuid,uuid)'),
  'public=false anon=false authenticated=false service_role=false definer=true config=search_path=public');

-- 画面の関数は auth.uid() を、道具用は p_actor を本体に渡す。本体は呼んだ人を p_actor から取り、auth.uid() を使わない
select test.check('chg_shells_pass_auth_uid', (
  select count(*)::text from test.fns f join pg_proc p on p.oid = to_regprocedure(f.shell_sig)
   where p.prosrc ~ ('public\._' || f.k || '_impl\(auth\.uid\(\), ')), '7');
select test.check('chg_as_pass_p_actor', (
  select count(*)::text from test.fns f join pg_proc p on p.oid = to_regprocedure(f.as_sig)
   where p.prosrc ~ ('public\._' || f.k || '_impl\(p_actor, ')), '7');
select test.check('chg_impl_use_p_actor', (
  select count(*)::text from test.fns f join pg_proc p on p.oid = to_regprocedure(f.impl_sig)
   where p.prosrc like '%v_actor_id := p_actor;%'
     and p.prosrc like '%public._actor_can_write_space(v_actor_id, %'
     and p.prosrc !~ 'auth\.uid\(\)'), '7');

-- 道具用はログイン中の人・未ログインの人は呼べない。本体は誰も直接呼べない
select test.check('chg_as_denied_for_authenticated', test.try_calls('authenticated', 'as'),
  'confirm_proposal_slot=42501 meeting_end=42501 meeting_start=42501 pass_ball=42501 review_approve=42501 review_block=42501 review_open=42501');
select test.check('chg_as_denied_for_anon', test.try_calls('anon', 'as'),
  'confirm_proposal_slot=42501 meeting_end=42501 meeting_start=42501 pass_ball=42501 review_approve=42501 review_block=42501 review_open=42501');
select test.check('chg_impl_denied_for_authenticated', test.try_calls('authenticated', 'impl'),
  'confirm_proposal_slot=42501 meeting_end=42501 meeting_start=42501 pass_ball=42501 review_approve=42501 review_block=42501 review_open=42501');
select test.check('chg_impl_denied_for_anon', test.try_calls('anon', 'impl'),
  'confirm_proposal_slot=42501 meeting_end=42501 meeting_start=42501 pass_ball=42501 review_approve=42501 review_block=42501 review_open=42501');
select test.check('chg_impl_denied_for_service_role', test.try_calls('service_role', 'impl'),
  'confirm_proposal_slot=42501 meeting_end=42501 meeting_start=42501 pass_ball=42501 review_approve=42501 review_block=42501 review_open=42501');

-- 道具用に p_actor を渡さないと、画面でログインしていないときと同じ断り方
select test.check('chg_as_without_actor_is_refused', (
  select string_agg(k || '=' || split_part(test.one('service_role', null, test.as_call(k, null)), E'\n', 1), ' | ' order by k)
    from test.fns),
  'confirm_proposal_slot=ok:result {"ok": false, "error": "authentication_required"}'
  || ' | meeting_end=err:P0001:Authentication required | meeting_start=err:P0001:Authentication required'
  || ' | pass_ball=err:P0001:Authentication required | review_approve=err:P0001:Authentication required'
  || ' | review_block=err:P0001:Authentication required | review_open=err:P0001:Authentication required');

-- 書き込める役割の判定: 呼んだ人で判定する関数と p_actor で判定する関数が、人（ログインしていない人を含む）と space の組ごとに同じ
select test.check('chg_actor_helper_matches_caller_helper', test.helper_parity(
  array[:'u_adm', :'u_ed', :'u_ed2', :'u_vw', :'u_cli', :'u_nom', :'u_out', :'u_per', null]::uuid[],
  array[:'S1', :'P1']::uuid[]), 'same (18 pairs)');

-- -----------------------------------------------------------------------------
-- 7本: 同じ人で、画面の関数と道具用の関数の結果が同じ
-- -----------------------------------------------------------------------------
\echo '== rpc_pass_ball =='
select test.pair('pass_ball_ed', 'pass_ball', :'u_ed', 'like:ok:result {"ok": true}%');
-- S1 の役割が無い社内の人（組織の member）は、書き込める役割の判定で editor 扱い
select test.pair('pass_ball_nom', 'pass_ball', :'u_nom', 'like:ok:result {"ok": true}%');
select test.pair('pass_ball_vw', 'pass_ball', :'u_vw', 'like:err:P0001:Not authorized to access this task%');
select test.pair('pass_ball_cli', 'pass_ball', :'u_cli', 'like:err:P0001:Not authorized to access this task%');
select test.pair('pass_ball_out', 'pass_ball', :'u_out', 'like:err:P0001:Not authorized to access this task%');

\echo '== rpc_meeting_start =='
select test.pair('meeting_start_ed', 'meeting_start', :'u_ed', 'like:ok:result {"ok": true}%');
select test.pair('meeting_start_vw', 'meeting_start', :'u_vw', 'like:err:P0001:Not authorized to access this meeting%');
select test.pair('meeting_start_cli', 'meeting_start', :'u_cli', 'like:err:P0001:Not authorized to access this meeting%');
select test.pair('meeting_start_out', 'meeting_start', :'u_out', 'like:err:P0001:Not authorized to access this meeting%');

\echo '== rpc_meeting_end =='
select test.pair('meeting_end_ed', 'meeting_end', :'u_ed', 'like:ok:result {"ok": true%');
select test.pair('meeting_end_vw', 'meeting_end', :'u_vw', 'like:err:P0001:Not authorized to end this meeting%');
select test.pair('meeting_end_cli', 'meeting_end', :'u_cli', 'like:err:P0001:Not authorized to end this meeting%');
-- 参加者でも S1 のメンバーでもない人は、書き込める役割でも断る
select test.pair('meeting_end_nom', 'meeting_end', :'u_nom', 'like:err:P0001:Not authorized to end this meeting%');
select test.pair('meeting_end_out', 'meeting_end', :'u_out', 'like:err:P0001:Not authorized to end this meeting%');

\echo '== rpc_review_open =='
select test.pair('review_open_ed', 'review_open', :'u_ed', 'like:ok:result {"ok": true}%');
select test.pair('review_open_adm', 'review_open', :'u_adm', 'like:ok:result {"ok": true}%');
select test.pair('review_open_nom', 'review_open', :'u_nom', 'like:err:P0001:Insufficient permissions%');
select test.pair('review_open_vw', 'review_open', :'u_vw', 'like:err:P0001:Insufficient permissions%');
select test.pair('review_open_cli', 'review_open', :'u_cli', 'like:err:P0001:Insufficient permissions%');
select test.pair('review_open_out', 'review_open', :'u_out', 'like:err:P0001:Insufficient permissions%');
select test.pair('review_open_badrev_ed', 'review_open_badrev', :'u_ed', 'like:err:P0001:One or more reviewer IDs are not internal members%');

\echo '== rpc_review_approve =='
select test.pair('review_approve_ed', 'review_approve', :'u_ed', 'like:ok:result {"ok": true, "allApproved": false}%');
select test.pair('review_approve_ed2', 'review_approve', :'u_ed2', 'like:ok:result {"ok": true, "allApproved": false}%');
select test.pair('review_approve_adm', 'review_approve', :'u_adm', 'like:err:P0001:User is not a reviewer for this task%');
select test.pair('review_approve_vw', 'review_approve', :'u_vw', 'like:err:P0001:Not authorized to access this review%');
select test.pair('review_approve_out', 'review_approve', :'u_out', 'like:err:P0001:Not authorized to access this review%');

\echo '== rpc_review_block =='
select test.pair('review_block_ed', 'review_block', :'u_ed', 'like:ok:result {"ok": true}%');
select test.pair('review_block_adm', 'review_block', :'u_adm', 'like:err:P0001:User is not a reviewer for this task%');
select test.pair('review_block_vw', 'review_block', :'u_vw', 'like:err:P0001:Not authorized to access this review%');
select test.pair('review_block_cli', 'review_block', :'u_cli', 'like:err:P0001:Not authorized to access this review%');
select test.pair('review_block_out', 'review_block', :'u_out', 'like:err:P0001:Not authorized to access this review%');

\echo '== rpc_confirm_proposal_slot =='
select test.pair('confirm_ed', 'confirm_proposal_slot', :'u_ed', 'like:ok:result {"ok": true%');
-- 提案を作った人でなくても、S1 の admin は確定できる
select test.pair('confirm_adm', 'confirm_proposal_slot', :'u_adm', 'like:ok:result {"ok": true%');
select test.pair('confirm_ed2', 'confirm_proposal_slot', :'u_ed2', 'like:ok:result {"ok": false, "error": "not_authorized"}%');
select test.pair('confirm_vw', 'confirm_proposal_slot', :'u_vw', 'like:ok:result {"ok": false, "error": "not_authorized"}%');
select test.pair('confirm_cli', 'confirm_proposal_slot', :'u_cli', 'like:ok:result {"ok": false, "error": "not_authorized"}%');
select test.pair('confirm_out', 'confirm_proposal_slot', :'u_out', 'like:ok:result {"ok": false, "error": "not_authorized"}%');
select test.pair('confirm_sl2_ed', 'confirm_sl2', :'u_ed', 'like:ok:result {"ok": false, "error": "not_all_agreed"%');

-- -----------------------------------------------------------------------------
-- 個人の space のタスク: 持ち主本人のセッション（画面）では書けて、道具用からは書けない（トリガーが auth.uid() を見る）
-- -----------------------------------------------------------------------------
\echo '== personal space =='
select test.check('same_pass_ball_personal_owner_shell',
  split_part(test.one('authenticated', :'u_per', test.shell_call('pass_ball_per')), E'\n', 1), 'like:ok:result {"ok": true}%');
select test.check('chg_pass_ball_personal_as_is_refused',
  split_part(test.one('service_role', null, test.as_call('pass_ball_per', :'u_per')), E'\n', 1),
  'like:err:P0001:Cannot write to another user personal space%');

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
    raise exception 'MCP RPC AS CHECKS FAILED (% failures)', v_fail;
  end if;
end $$;
select 'MCP RPC AS CHECKS PASSED' as result;
