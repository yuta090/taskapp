-- =============================================================================
-- GitHub Issues 連携（PR1 の DB 部分）の挙動検証
-- 前提: run_github_issues_link.sh が baseline → 実 migration を verbatim 適用済み。
-- 仕様: docs/spec/GITHUB_ISSUES_LINK_SPEC.md v1.1 §5・§6・§7.4・§9 PR1
--
-- 視点（org O1 に S1=お客さんA / S2=お客さんB、別 org O2 に S3）:
--   int_own    社内 owner（S1・S2 の space admin）
--   int_mem    社内 member（S1 の space editor）
--   int_view   社内 member（S1 の space viewer）
--   int_memout 社内 member（どの space にも入っていない）
--   int_o2     別 org O2 の社内 member（S3 の editor）
--   int_both   O1・O2 の両方で社内 member（S1・S3 の editor）… 組織一致トリガーの確認用
--   ext_cli    client（org=client ＋ S1 space=client）
--   ext_ven    vendor（org=client ＋ S1 space=vendor：rpc_accept_invite の実マッピング）
--   ext_clied  org=client だが S1 の space role が editor
--   ext_cliadm org=client だが S1 の space role が admin
--   ext_dual   O1 では client（S1 editor）だが、別 org O2 では社内 member
--   mfa_*      社内 member（S1 editor）で二要素認証を登録済み。aal1（コード未入力）/ aal2
--
-- 出力: PASS[label] / FAIL[label]。最後に FAIL が 0 件なら
--   "GITHUB ISSUES LINK CHECKS PASSED"。1件でもあれば例外で終了する。
-- 書き込み系は test.try がサブトランザクション内で実行し必ず巻き戻す（各 assert は独立）。
-- 末尾の cascade 節だけは実際に行を消す（最後に置く）。
-- label: shape_*（形）/ int_*・ext_*・mfa_*（視点）/ trg_*（組織一致トリガー）/
--        ck_*・uq_*・df_*（制約・既定値）/ fn_*（集計関数そのもの。紐づけトリガーは止めて確かめる）/
--        lt_*（紐づけの追加・削除で集計し直すトリガー）/ casc_*（連鎖削除）
-- =============================================================================
set client_min_messages = notice;

\set O1 '00000000-0000-0000-0000-0000000000a1'
\set O2 '00000000-0000-0000-0000-0000000000a2'
\set O3 '00000000-0000-0000-0000-0000000000a3'
\set S1 '00000000-0000-0000-0000-0000000000b1'
\set S2 '00000000-0000-0000-0000-0000000000b2'
\set S3 '00000000-0000-0000-0000-0000000000b3'
\set S4 '00000000-0000-0000-0000-0000000000b4'
\set u_own    '00000000-0000-0000-0000-0000000000c1'
\set u_mem    '00000000-0000-0000-0000-0000000000c2'
\set u_memout '00000000-0000-0000-0000-0000000000c3'
\set u_cli    '00000000-0000-0000-0000-0000000000c4'
\set u_ven    '00000000-0000-0000-0000-0000000000c5'
\set u_clied  '00000000-0000-0000-0000-0000000000c6'
\set u_cliadm '00000000-0000-0000-0000-0000000000c7'
\set u_view   '00000000-0000-0000-0000-0000000000c8'
\set u_o2     '00000000-0000-0000-0000-0000000000c9'
\set u_dual   '00000000-0000-0000-0000-0000000000ca'
\set u_both   '00000000-0000-0000-0000-0000000000cb'
\set u_mfa    '00000000-0000-0000-0000-0000000000cc'
\set T1     '00000000-0000-0000-0000-0000000000d1'
\set T1b    '00000000-0000-0000-0000-0000000000d2'
\set T2     '00000000-0000-0000-0000-0000000000d3'
\set T3     '00000000-0000-0000-0000-0000000000d4'
\set TR     '00000000-0000-0000-0000-0000000000d5'
\set TU     '00000000-0000-0000-0000-0000000000d6'
\set TP     '00000000-0000-0000-0000-0000000000d7'
\set TD     '00000000-0000-0000-0000-0000000000d8'
\set TM     '00000000-0000-0000-0000-0000000000d9'
\set TX     '00000000-0000-0000-0000-0000000000da'
\set TY     '00000000-0000-0000-0000-0000000000db'
\set TZ     '00000000-0000-0000-0000-0000000000de'
\set T4     '00000000-0000-0000-0000-0000000000e4'
\set TA1    '00000000-0000-0000-0000-0000000000f1'
\set TA2    '00000000-0000-0000-0000-0000000000f2'
\set TA3    '00000000-0000-0000-0000-0000000000f3'
\set ap44   '00000000-0000-0000-0000-000000001044'
\set T_none '00000000-0000-0000-0000-0000000000df'
-- Issue の書き換えと再計算の RPC 用の Issue（O1 / R1。43 は RPC が新しく作る）
\set ap41 '00000000-0000-0000-0000-000000001041'
\set ap42 '00000000-0000-0000-0000-000000001042'
\set I1 '00000000-0000-0000-0000-000000000a01'
\set I2 '00000000-0000-0000-0000-000000000a02'
\set R1 '00000000-0000-0000-0000-0000000000e1'
\set R3 '00000000-0000-0000-0000-0000000000e3'
\set R4 '00000000-0000-0000-0000-0000000000e5'
\set SG1 '00000000-0000-0000-0000-000000000b01'
\set SG3 '00000000-0000-0000-0000-000000000b03'
-- 視点用の Issue
\set iss1 '00000000-0000-0000-0000-000000001001'
\set iss2 '00000000-0000-0000-0000-000000001002'
\set iss3 '00000000-0000-0000-0000-000000001003'
\set iss9 '00000000-0000-0000-0000-000000001009'
\set iss_none '00000000-0000-0000-0000-0000000010ff'
-- 集計関数用の Issue（i4 以外はすべて O1 / R1）
\set ra  '00000000-0000-0000-0000-000000001011'
\set rb  '00000000-0000-0000-0000-000000001012'
\set rc  '00000000-0000-0000-0000-000000001013'
\set rd  '00000000-0000-0000-0000-000000001014'
\set re  '00000000-0000-0000-0000-000000001015'
\set rf  '00000000-0000-0000-0000-000000001016'
\set ru  '00000000-0000-0000-0000-000000001017'
\set rp1 '00000000-0000-0000-0000-000000001018'
\set rp2 '00000000-0000-0000-0000-000000001019'
\set rdl '00000000-0000-0000-0000-00000000101a'
\set i4  '00000000-0000-0000-0000-00000000101b'
-- 紐づけトリガー用の Issue（すべて O1 / R1）
\set im1 '00000000-0000-0000-0000-000000001031'
\set im2 '00000000-0000-0000-0000-000000001032'
\set ix1 '00000000-0000-0000-0000-000000001033'
\set ix2 '00000000-0000-0000-0000-000000001034'
\set iy1 '00000000-0000-0000-0000-000000001035'
\set iy2 '00000000-0000-0000-0000-000000001036'
-- 紐づけ
\set L1 '00000000-0000-0000-0000-000000002001'
\set L2 '00000000-0000-0000-0000-000000002002'
\set L3 '00000000-0000-0000-0000-000000002003'
\set L4 '00000000-0000-0000-0000-000000002004'
\set L5 '00000000-0000-0000-0000-000000002005'

-- -----------------------------------------------------------------------------
-- 検証ヘルパ（plpgsql は実行時に名前を解決するので、表が無い RED でも作成できる）
-- -----------------------------------------------------------------------------
create schema if not exists test;
grant usage on schema test to authenticated, anon, service_role;
create table test.results (seq serial primary key, label text, ok boolean, got text, want text);

-- 結果の記録（definer: どの視点からでも記録できる）
--   want='denied' は denied:<SQLSTATE> を全て許容、それ以外は完全一致。
create or replace function test.check(p_label text, p_got text, p_want text)
returns void language plpgsql security definer set search_path = test, public as $$
declare
  v_ok boolean := coalesce(p_got = p_want or (p_want = 'denied' and p_got like 'denied:%'), false);
begin
  insert into test.results(label, ok, got, want) values (p_label, v_ok, p_got, p_want);
  if v_ok then
    raise notice 'PASS[%]: %', p_label, p_got;
  else
    raise notice 'FAIL[%]: got %, want %', p_label, coalesce(p_got, 'NULL'), p_want;
  end if;
end $$;

-- 呼び出し元の権限（= RLS が効く）で SQL を実行し、結果を返して必ず巻き戻す。
--   ok:<影響行数> / denied:42501（RLS・権限の拒否）/ denied:P0001（トリガーの拒否）/
--   violation:23xxx（制約違反）/ error:<その他>
create or replace function test.try(p_sql text)
returns text language plpgsql security invoker as $$
declare
  v_n bigint;
  v_state text;
  v_detail text;
  v_msg text;
begin
  begin
    execute p_sql;
    get diagnostics v_n = row_count;
    raise exception 'test_rollback' using errcode = 'TR001', detail = v_n::text;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate,
                            v_detail = pg_exception_detail,
                            v_msg = message_text;
    if v_state = 'TR001' then return 'ok:' || v_detail; end if;
    if v_state in ('42501', 'P0001') then return 'denied:' || v_state; end if;
    if v_state like '23%' then return 'violation:' || v_state; end if;
    -- 関数・表が無い（RED で migration が未完成）: ハーネスの不備ではなく FAIL として記録させる
    if v_state in ('42883', '42P01') then return 'missing:' || v_state; end if;
    return 'error:' || v_state || ':' || v_msg;
  end;
end $$;

create or replace function test.ins_link(p_org uuid, p_task uuid, p_issue uuid, p_type text, p_by uuid)
returns text language plpgsql as $$
begin
  return test.try(format(
    'insert into public.task_github_issue_links(org_id, task_id, github_issue_id, link_type, created_by) values (%L, %L, %L, %L, %L)',
    p_org, p_task, p_issue, p_type, p_by));
end $$;

create or replace function test.del(p_table text, p_id uuid)
returns text language plpgsql as $$
begin
  return test.try(format('delete from public.%I where id = %L', p_table, p_id));
end $$;

create or replace function test.upd(p_table text, p_set text, p_id uuid)
returns text language plpgsql as $$
begin
  return test.try(format('update public.%I set %s where id = %L', p_table, p_set, p_id));
end $$;

-- 3表の見える行数を呼び出し元の視点で数えて記録する
create or replace function test.check_counts(p_who text, p_issues int, p_links int, p_rollups int)
returns void language plpgsql security invoker as $$
begin
  perform test.check(p_who || '_issues',  (select count(*) from public.github_issues)::text,             p_issues::text);
  perform test.check(p_who || '_links',   (select count(*) from public.task_github_issue_links)::text,   p_links::text);
  perform test.check(p_who || '_rollups', (select count(*) from public.task_github_issue_rollups)::text, p_rollups::text);
end $$;

-- 集計関数を呼んで、戻り値を1行の文字列にする（0行なら 'no-row'、例外なら 'raised:<SQLSTATE>'）
create or replace function test.rollup(p_task uuid)
returns text language plpgsql security invoker as $$
declare
  v text;
begin
  begin
    select format('%s>%s c=%s np=%s ac=%s became=%s',
                  r.open_count_before, r.open_count_after,
                  r.completed_count_after, r.not_planned_count_after,
                  (r.all_closed_at_after is not null)::text, r.became_all_closed::text)
      into v
      from public.github_recompute_issue_rollup(p_task) r;
  exception when others then
    return 'raised:' || sqlstate;
  end;
  return coalesce(v, 'no-row');
end $$;

-- 集計行そのものを1行の文字列にする（行が無ければ 'no-row'）
create or replace function test.rollup_row(p_task uuid)
returns text language plpgsql security invoker as $$
declare
  v text;
begin
  select format('open=%s c=%s np=%s ac=%s', r.open_count, r.completed_count, r.not_planned_count,
                case when r.all_closed_at is null then 'null' else 'set' end)
    into v
    from public.task_github_issue_rollups r
   where r.task_id = p_task;
  return coalesce(v, 'no-row');
end $$;

-- 紐づけトリガー（集計し直す方。名前が task_github_issue_links_recompute_rollup で始まるもの全部）を止める/戻す。
-- 無い（RED）ときは何もしない
create or replace function test.set_link_rollup_trigger(p_enabled boolean)
returns void language plpgsql as $$
declare
  v_name text;
begin
  for v_name in
    select tgname from pg_trigger
    where tgrelid = to_regclass('public.task_github_issue_links')
      and tgname like 'task_github_issue_links_recompute_rollup%'
  loop
    execute format('alter table public.task_github_issue_links %s trigger %I',
                   case when p_enabled then 'enable' else 'disable' end, v_name);
  end loop;
end $$;

-- Issue の書き換えと再計算の RPC を呼び、戻り値をタスク順に1行の文字列にする
--   <task_id の末尾2文字>:<変更前 open>><変更後 open> c= np= ac= became=（; でつなぐ）。0行なら 'no-row'、例外なら 'raised:<SQLSTATE>'
--   apply_at は github_updated_at（GitHub 側の更新時刻）を指定する。apply はその時刻に now() を使う
create or replace function test.apply_at(p_org uuid, p_repo uuid, p_number int, p_state text, p_reason text,
                                         p_assignees text[], p_updated_at timestamptz)
returns text language plpgsql security invoker as $$
declare
  v text;
begin
  begin
    select string_agg(format('%s:%s>%s c=%s np=%s ac=%s became=%s',
                             right(r.task_id::text, 2), r.open_count_before, r.open_count_after,
                             r.completed_count_after, r.not_planned_count_after,
                             (r.all_closed_at_after is not null)::text, r.became_all_closed::text),
                      ';' order by r.task_id)
      into v
      from public.github_apply_issue_state(
        p_org, p_repo, p_number, 'title-' || p_number, 'https://example.invalid/i/' || p_number,
        p_state, p_reason, 'author-1', p_assignees, '2026-01-01T00:00:00Z'::timestamptz,
        case when p_state = 'closed' then now() end, p_updated_at) r;
  exception when others then
    return 'raised:' || sqlstate;
  end;
  return coalesce(v, 'no-row');
end $$;

create or replace function test.apply(p_org uuid, p_repo uuid, p_number int, p_state text, p_reason text, p_assignees text[])
returns text language plpgsql security invoker as $$
begin
  return test.apply_at(p_org, p_repo, p_number, p_state, p_reason, p_assignees, now());
end $$;

-- 表の索引の形（P=主キー / U=一意 / N=通常 ＋ 列）。表が無ければ 'missing'
create or replace function test.index_shape(p_table text)
returns text language plpgsql stable as $$
declare
  v text;
begin
  select string_agg(s, ';' order by s) into v
  from (
    select (case when ix.indisprimary then 'P' when ix.indisunique then 'U' else 'N' end)
           || ':' || string_agg(a.attname::text, ',' order by k.ord) as s
    from pg_index ix
    join pg_class c on c.oid = ix.indrelid
    join pg_namespace ns on ns.oid = c.relnamespace
    cross join lateral unnest(ix.indkey::int2[]) with ordinality as k(attnum, ord)
    join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
    where ns.nspname = 'public' and c.relname = p_table
    group by ix.indexrelid, ix.indisprimary, ix.indisunique
  ) x;
  return coalesce(v, 'missing');
end $$;

-- 外部キーの形（列->参照先:削除時の動作 c=cascade / n=set null / a=no action）。表が無ければ 'missing'
create or replace function test.fk_shape(p_table text)
returns text language plpgsql stable as $$
declare
  v text;
begin
  select string_agg(s, ';' order by s) into v
  from (
    select a.attname::text || '->' || rc.relname::text || ':' || co.confdeltype::text as s
    from pg_constraint co
    join pg_class c on c.oid = co.conrelid
    join pg_namespace ns on ns.oid = c.relnamespace
    join pg_class rc on rc.oid = co.confrelid
    join pg_attribute a on a.attrelid = c.oid and a.attnum = co.conkey[1]
    where co.contype = 'f' and ns.nspname = 'public' and c.relname = p_table
  ) x;
  return coalesce(v, 'missing');
end $$;

-- -----------------------------------------------------------------------------
-- 形（表が無い RED でもエラーにならず FAIL を記録する）
-- -----------------------------------------------------------------------------
\echo '== shape =='
select test.check('shape_tables_exist', (
  select count(*) from unnest(array['public.github_issues', 'public.task_github_issue_links',
                                     'public.task_github_issue_rollups']) n
  where to_regclass(n) is not null)::text, '3');

select test.check('shape_rls_enabled', (
  select count(*) from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
  where ns.nspname = 'public'
    and c.relname in ('github_issues', 'task_github_issue_links', 'task_github_issue_rollups')
    and c.relrowsecurity)::text, '3');

-- 二要素認証: 既存の全表と同じ名前・同じ式の RESTRICTIVE ポリシーが3表とも付いていること
select test.check('shape_mfa_restrictive_policy', (
  select count(*) from pg_policies p
  where p.schemaname = 'public'
    and p.tablename in ('github_issues', 'task_github_issue_links', 'task_github_issue_rollups')
    and p.policyname = 'mfa_required_when_enrolled'
    and p.permissive = 'RESTRICTIVE'
    and p.cmd = 'ALL'
    and p.roles = array['authenticated']::name[]
    and p.qual like '%mfa_satisfied()%'
    and p.with_check like '%mfa_satisfied()%')::text, '3');
-- 20260907144900 の mfa_enforcement_status().policy_missing と同じ判定（RLS 表で付け忘れが無い）
select test.check('shape_mfa_policy_missing_none', (
  select coalesce(string_agg(t.tablename::text, ',' order by t.tablename), '')
  from pg_tables t
  where t.schemaname = 'public' and t.rowsecurity
    and not exists (select 1 from pg_policies p
                    where p.schemaname = 'public' and p.tablename = t.tablename
                      and p.policyname = 'mfa_required_when_enrolled')), '');

-- permissive ポリシーは「github_issues の select / links の select・insert・delete / rollups の select」だけ
--   （github_issues・rollups に書込ポリシーが無い、links に update が無い）
select test.check('shape_permissive_policy_set', (
  select coalesce(string_agg(p.tablename::text || ':' || p.cmd, ',' order by p.tablename, p.cmd), '')
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename in ('github_issues', 'task_github_issue_links', 'task_github_issue_rollups')
    and p.permissive = 'PERMISSIVE'),
  'github_issues:SELECT,task_github_issue_links:DELETE,task_github_issue_links:INSERT,task_github_issue_links:SELECT,task_github_issue_rollups:SELECT');
select test.check('shape_permissive_policies_internal', (
  select count(*) from pg_policies p
  where p.schemaname = 'public'
    and p.tablename in ('github_issues', 'task_github_issue_links', 'task_github_issue_rollups')
    and p.permissive = 'PERMISSIVE'
    and coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') not like '%app_is_org_internal%')::text, '0');

select test.check('shape_index_issues', test.index_shape('github_issues'),
  'N:org_id,state;P:id;U:github_repo_id,issue_number');
select test.check('shape_index_links', test.index_shape('task_github_issue_links'),
  'N:github_issue_id;P:id;U:task_id,github_issue_id');
select test.check('shape_index_rollups', test.index_shape('task_github_issue_rollups'), 'P:task_id');

select test.check('shape_fk_issues', test.fk_shape('github_issues'),
  'github_repo_id->github_repositories:c;org_id->organizations:c');
select test.check('shape_fk_links', test.fk_shape('task_github_issue_links'),
  'created_by->users:n;github_issue_id->github_issues:c;org_id->organizations:c;task_id->tasks:c');
select test.check('shape_fk_rollups', test.fk_shape('task_github_issue_rollups'),
  'org_id->organizations:c;task_id->tasks:c');

-- 組織一致トリガー: SECURITY DEFINER・search_path 固定・insert/update の前に動く・直接は実行させない
select test.check('shape_org_check_fn_definer', (
  select p.prosecdef::text || ':' || coalesce(array_to_string(p.proconfig, ','), '')
  from pg_proc p where p.oid = to_regprocedure('public.check_task_issue_org_match()')),
  'true:search_path=public');
select test.check('shape_org_check_trigger', (
  select string_agg(t.event_manipulation::text, ',' order by t.event_manipulation)
  from information_schema.triggers t
  where t.event_object_schema = 'public'
    and t.event_object_table = 'task_github_issue_links'
    and t.trigger_name = 'task_github_issue_links_org_check'
    and t.action_timing = 'BEFORE'
    and t.action_statement like '%check_task_issue_org_match%'), 'INSERT,UPDATE');
select test.check('shape_org_check_fn_acl', (
  select format('public=%s anon=%s authenticated=%s',
                has_function_privilege('public', f, 'execute')::text,
                has_function_privilege('anon', f, 'execute')::text,
                has_function_privilege('authenticated', f, 'execute')::text)
  from (select to_regprocedure('public.check_task_issue_org_match()') as f) x where f is not null),
  'public=false anon=false authenticated=false');

-- 集計関数: SECURITY DEFINER・search_path 固定・実行は service_role のみ
select test.check('shape_rollup_fn_definer', (
  select p.prosecdef::text || ':' || coalesce(array_to_string(p.proconfig, ','), '')
  from pg_proc p where p.oid = to_regprocedure('public.github_recompute_issue_rollup(uuid)')),
  'true:search_path=public');
select test.check('shape_rollup_fn_acl', (
  select format('public=%s anon=%s authenticated=%s service_role=%s',
                has_function_privilege('public', f, 'execute')::text,
                has_function_privilege('anon', f, 'execute')::text,
                has_function_privilege('authenticated', f, 'execute')::text,
                has_function_privilege('service_role', f, 'execute')::text)
  from (select to_regprocedure('public.github_recompute_issue_rollup(uuid)') as f) x where f is not null),
  'public=false anon=false authenticated=false service_role=true');
-- 所有者（= 紐づけトリガーの関数の実行者）は revoke 後も実行できる（本番の postgres は superuser ではないので明示で確かめる）
select test.check('shape_rollup_fn_owner_can_execute', (
  select exists (select 1 from aclexplode(p.proacl) a
                 where a.grantee = p.proowner and a.privilege_type = 'EXECUTE')::text
  from pg_proc p where p.oid = to_regprocedure('public.github_recompute_issue_rollup(uuid)')), 'true');

-- 紐づけの追加・削除で集計し直すトリガー: 文ごと（変わった紐づけを遷移テーブル changed_links で受け、task_id の順に
--   処理する＝RPC と同じ順番でロックする）・AFTER INSERT / AFTER DELETE の2本・SECURITY DEFINER・直接は実行させない
select test.check('shape_link_rollup_triggers', (
  select string_agg(t.event_manipulation::text || ':' || t.action_orientation::text || ':'
                    || coalesce(t.action_reference_new_table::text, '-') || ':'
                    || coalesce(t.action_reference_old_table::text, '-'), ',' order by t.event_manipulation)
  from information_schema.triggers t
  where t.event_object_schema = 'public'
    and t.event_object_table = 'task_github_issue_links'
    and t.trigger_name like 'task_github_issue_links_recompute_rollup%'
    and t.action_timing = 'AFTER'
    and t.action_statement like '%github_issue_link_recompute_rollup%'),
  'DELETE:STATEMENT:-:changed_links,INSERT:STATEMENT:changed_links:-');

-- Issue の書き換えと再計算の RPC: 1つだけ・SECURITY DEFINER・search_path 固定・実行は service_role のみ
select test.check('shape_apply_fn_single', (
  select count(*) from pg_proc where proname = 'github_apply_issue_state' and pronamespace = 'public'::regnamespace)::text, '1');
select test.check('shape_apply_fn_definer', (
  select p.prosecdef::text || ':' || coalesce(array_to_string(p.proconfig, ','), '')
  from pg_proc p where p.proname = 'github_apply_issue_state' and p.pronamespace = 'public'::regnamespace limit 1),
  'true:search_path=public');
select test.check('shape_apply_fn_acl', (
  select format('public=%s anon=%s authenticated=%s service_role=%s',
                has_function_privilege('public', p.oid, 'execute')::text,
                has_function_privilege('anon', p.oid, 'execute')::text,
                has_function_privilege('authenticated', p.oid, 'execute')::text,
                has_function_privilege('service_role', p.oid, 'execute')::text)
  from pg_proc p where p.proname = 'github_apply_issue_state' and p.pronamespace = 'public'::regnamespace limit 1),
  'public=false anon=false authenticated=false service_role=true');
select test.check('shape_link_rollup_fn_definer', (
  select p.prosecdef::text || ':' || coalesce(array_to_string(p.proconfig, ','), '')
  from pg_proc p where p.oid = to_regprocedure('public.github_issue_link_recompute_rollup()')),
  'true:search_path=public');
select test.check('shape_link_rollup_fn_acl', (
  select format('public=%s anon=%s authenticated=%s',
                has_function_privilege('public', f, 'execute')::text,
                has_function_privilege('anon', f, 'execute')::text,
                has_function_privilege('authenticated', f, 'execute')::text)
  from (select to_regprocedure('public.github_issue_link_recompute_rollup()') as f) x where f is not null),
  'public=false anon=false authenticated=false');

-- github_issues.updated_at を更新のたびに進めるトリガー（既存 GitHub 表と同じ関数）
select test.check('shape_issues_updated_at_trigger', (
  select count(*) from information_schema.triggers t
  where t.event_object_schema = 'public' and t.event_object_table = 'github_issues'
    and t.trigger_name = 'github_issues_updated_at' and t.action_timing = 'BEFORE'
    and t.event_manipulation = 'UPDATE')::text, '1');

-- -----------------------------------------------------------------------------
-- データ（postgres で投入。RLS は通らない）
-- -----------------------------------------------------------------------------
\echo '== data =='
insert into public.organizations(id) values (:'O1'), (:'O2');
insert into public.spaces(id, org_id, name) values
  (:'S1', :'O1', 'customer-a'),
  (:'S2', :'O1', 'customer-b'),
  (:'S3', :'O2', 'o2-space');
insert into auth.users(id) values
  (:'u_own'), (:'u_mem'), (:'u_memout'), (:'u_cli'), (:'u_ven'), (:'u_clied'),
  (:'u_cliadm'), (:'u_view'), (:'u_o2'), (:'u_dual'), (:'u_both'), (:'u_mfa');

insert into public.org_memberships(org_id, user_id, role) values
  (:'O1', :'u_own',    'owner'),
  (:'O1', :'u_mem',    'member'),
  (:'O1', :'u_memout', 'member'),
  (:'O1', :'u_view',   'member'),
  (:'O1', :'u_cli',    'client'),
  (:'O1', :'u_ven',    'client'),   -- vendor 招待の受諾結果は org=client（20260706004313）
  (:'O1', :'u_clied',  'client'),
  (:'O1', :'u_cliadm', 'client'),
  (:'O1', :'u_dual',   'client'),
  (:'O1', :'u_both',   'member'),
  (:'O1', :'u_mfa',    'member'),
  (:'O2', :'u_o2',     'member'),
  (:'O2', :'u_dual',   'member'),
  (:'O2', :'u_both',   'member');
insert into public.space_memberships(space_id, user_id, role) values
  (:'S1', :'u_own',    'admin'),
  (:'S2', :'u_own',    'admin'),
  (:'S1', :'u_mem',    'editor'),
  (:'S1', :'u_view',   'viewer'),
  (:'S1', :'u_cli',    'client'),
  (:'S1', :'u_ven',    'vendor'),   -- vendor 招待の受諾結果は space=vendor
  (:'S1', :'u_clied',  'editor'),
  (:'S1', :'u_cliadm', 'admin'),
  (:'S1', :'u_dual',   'editor'),
  (:'S1', :'u_both',   'editor'),
  (:'S3', :'u_both',   'editor'),
  (:'S1', :'u_mfa',    'editor'),
  (:'S3', :'u_o2',     'editor');
-- u_mfa だけ二要素認証を登録済み（ほかの利用者は未登録 = mfa_satisfied() が常に true）
insert into auth.mfa_factors(user_id, status) values (:'u_mfa', 'verified');

-- タスクは全て deliverable（お客さんにも見えるタスク）＝社外視点で最も見えやすい条件で試す
insert into public.tasks(id, org_id, space_id, title, ball, client_scope) values
  (:'T1',  :'O1', :'S1', 't1',  'internal', 'deliverable'),
  (:'T1b', :'O1', :'S1', 't1b', 'internal', 'deliverable'),
  (:'T2',  :'O1', :'S2', 't2',  'internal', 'deliverable'),
  (:'T3',  :'O2', :'S3', 't3',  'internal', 'deliverable'),
  (:'TR',  :'O1', :'S1', 'tr',  'internal', 'deliverable'),
  (:'TU',  :'O1', :'S1', 'tu',  'internal', 'deliverable'),
  (:'TP',  :'O1', :'S1', 'tp',  'internal', 'deliverable'),
  (:'TD',  :'O1', :'S1', 'td',  'internal', 'deliverable'),
  (:'TM',  :'O1', :'S1', 'tm',  'internal', 'deliverable'),
  (:'TX',  :'O1', :'S1', 'tx',  'internal', 'deliverable'),
  (:'TY',  :'O1', :'S1', 'ty',  'internal', 'deliverable'),
  (:'TZ',  :'O1', :'S1', 'tz',  'internal', 'deliverable');

insert into public.github_installations(id, org_id, installation_id, account_login, created_by) values
  (:'I1', :'O1', 101, 'o1-gh', :'u_own'),
  (:'I2', :'O2', 202, 'o2-gh', :'u_o2');
insert into public.github_repositories(id, org_id, installation_id, repo_id, owner_login, repo_name) values
  (:'R1', :'O1', 101, 1001, 'o1-gh', 'repo-a'),
  (:'R3', :'O2', 202, 2001, 'o2-gh', 'repo-c');
insert into public.space_github_repos(id, org_id, space_id, github_repo_id, created_by) values
  (:'SG1', :'O1', :'S1', :'R1', :'u_own'),
  (:'SG3', :'O2', :'S3', :'R3', :'u_o2');

insert into public.github_issues(id, org_id, github_repo_id, issue_number, title, url, state, state_reason) values
  (:'iss1', :'O1', :'R1', 1, 'issue-1', 'https://example.invalid/i/1', 'open',   null),
  (:'iss2', :'O1', :'R1', 2, 'issue-2', 'https://example.invalid/i/2', 'closed', 'completed'),
  (:'iss3', :'O1', :'R1', 3, 'issue-3', 'https://example.invalid/i/3', 'open',   null),
  (:'iss9', :'O2', :'R3', 9, 'issue-9', 'https://example.invalid/i/9', 'open',   null);

-- L5 は「作成時は社内だったが、いまは org=client の利用者」が作成者の紐づけを再現
insert into public.task_github_issue_links(id, org_id, task_id, github_issue_id, link_type, created_by) values
  (:'L1', :'O1', :'T1',  :'iss1', 'manual', :'u_mem'),
  (:'L2', :'O1', :'T1',  :'iss2', 'auto',   null),
  (:'L3', :'O1', :'T2',  :'iss3', 'manual', :'u_own'),
  (:'L4', :'O2', :'T3',  :'iss9', 'auto',   null),
  (:'L5', :'O1', :'T1b', :'iss1', 'manual', :'u_clied');

-- 読み取り確認用の集計行（紐づけのあるタスクごとに1行）。紐づけトリガーがあれば既に作られているので
--   on conflict do nothing。読み取りの assert は行数だけを見る（値は fn_* / lt_* で別に確かめる）
insert into public.task_github_issue_rollups(task_id, org_id, open_count, completed_count) values
  (:'T1',  :'O1', 1, 1),
  (:'T1b', :'O1', 1, 0),
  (:'T2',  :'O1', 1, 0),
  (:'T3',  :'O2', 1, 0)
on conflict (task_id) do nothing;

-- -----------------------------------------------------------------------------
-- 読み取り: 視点ごとの見える行数（issues / links / rollups）
-- -----------------------------------------------------------------------------
set role authenticated;

\echo '== read: internal viewpoints =='
select set_config('test.uid', :'u_own', false);
select test.check_counts('int_own', 3, 4, 3);

select set_config('test.uid', :'u_mem', false);
select test.check_counts('int_mem', 3, 3, 2);
select test.check('int_mem_links_not_s2',   (select count(*) from public.task_github_issue_links   where task_id = :'T2')::text, '0');
select test.check('int_mem_rollups_not_s2', (select count(*) from public.task_github_issue_rollups where task_id = :'T2')::text, '0');

select set_config('test.uid', :'u_view', false);
select test.check_counts('int_view', 3, 3, 2);

select set_config('test.uid', :'u_memout', false);
select test.check_counts('int_memout', 3, 0, 0);

select set_config('test.uid', :'u_o2', false);
select test.check_counts('int_o2', 1, 1, 1);

select set_config('test.uid', :'u_both', false);
select test.check_counts('int_both', 4, 4, 3);

\echo '== read: external viewpoints (all must be 0) =='
select set_config('test.uid', :'u_cli', false);
select test.check_counts('ext_cli', 0, 0, 0);

select set_config('test.uid', :'u_ven', false);
select test.check_counts('ext_ven', 0, 0, 0);

select set_config('test.uid', :'u_clied', false);
select test.check_counts('ext_clied', 0, 0, 0);

select set_config('test.uid', :'u_cliadm', false);
select test.check_counts('ext_cliadm', 0, 0, 0);

-- dual は O2 の社内 member なので O2 の Issue は見える（S3 のメンバーではないので紐づけ・集計は見えない）。
-- O1 側（client としての所属先）の行は3表とも 0 であること。
select set_config('test.uid', :'u_dual', false);
select test.check_counts('ext_dual', 1, 0, 0);
select test.check('ext_dual_o1_rows',
  ((select count(*) from public.github_issues             where org_id = :'O1')
 + (select count(*) from public.task_github_issue_links   where org_id = :'O1')
 + (select count(*) from public.task_github_issue_rollups where org_id = :'O1'))::text, '0');

\echo '== read: MFA (enrolled user) =='
-- コード未入力（aal1）: 社内 member でも3表とも 0
select set_config('test.uid', :'u_mfa', false);
select set_config('request.jwt.claims', '', false);
select test.check_counts('mfa_aal1', 0, 0, 0);
-- コード入力済み（aal2）: 社内 member（S1 editor）として見える
select set_config('request.jwt.claims', '{"aal":"aal2"}', false);
select test.check_counts('mfa_aal2', 3, 3, 2);
select set_config('request.jwt.claims', '', false);

-- -----------------------------------------------------------------------------
-- 書き込み: task_github_issue_links
--   insert = 社内 かつ space admin/editor かつ link_type='manual'
--   delete = (作成者 or space admin) かつ 社内 / update なし
-- -----------------------------------------------------------------------------
\echo '== write: task_github_issue_links =='
select set_config('test.uid', :'u_mem', false);
select test.check('int_mem_insert_link',             test.ins_link(:'O1', :'T1b', :'iss3', 'manual',  :'u_mem'), 'ok:1');
select test.check('int_mem_insert_link_auto',        test.ins_link(:'O1', :'T1b', :'iss3', 'auto',    :'u_mem'), 'denied:42501');
select test.check('int_mem_insert_link_created',     test.ins_link(:'O1', :'T1b', :'iss3', 'created', :'u_mem'), 'denied:42501');
select test.check('int_mem_insert_link_other_space', test.ins_link(:'O1', :'T2',  :'iss1', 'manual',  :'u_mem'), 'denied:42501');
select test.check('int_mem_insert_link_dup',         test.ins_link(:'O1', :'T1',  :'iss1', 'manual',  :'u_mem'), 'violation:23505');
select test.check('int_mem_delete_own_link',         test.del('task_github_issue_links', :'L1'), 'ok:1');
select test.check('int_mem_delete_others_link',      test.del('task_github_issue_links', :'L2'), 'ok:0');
select test.check('int_mem_update_link',             test.upd('task_github_issue_links', 'link_type = ''auto''', :'L1'), 'ok:0');

select set_config('test.uid', :'u_view', false);
select test.check('int_view_insert_link', test.ins_link(:'O1', :'T1b', :'iss3', 'manual', :'u_view'), 'denied:42501');
select test.check('int_view_delete_link', test.del('task_github_issue_links', :'L1'), 'ok:0');

select set_config('test.uid', :'u_memout', false);
select test.check('int_memout_insert_link', test.ins_link(:'O1', :'T1b', :'iss3', 'manual', :'u_memout'), 'denied:42501');

select set_config('test.uid', :'u_own', false);
select test.check('int_own_insert_link',                test.ins_link(:'O1', :'T1b', :'iss3', 'manual', :'u_own'), 'ok:1');
select test.check('int_own_delete_link_as_space_admin', test.del('task_github_issue_links', :'L2'), 'ok:1');
select test.check('int_own_update_link',                test.upd('task_github_issue_links', 'link_type = ''auto''', :'L1'), 'ok:0');

select set_config('test.uid', :'u_o2', false);
select test.check('int_o2_delete_o1_link', test.del('task_github_issue_links', :'L1'), 'ok:0');

select set_config('test.uid', :'u_cli', false);
select test.check('ext_cli_insert_link', test.ins_link(:'O1', :'T1b', :'iss3', 'manual', :'u_cli'), 'denied:42501');

select set_config('test.uid', :'u_ven', false);
select test.check('ext_ven_insert_link', test.ins_link(:'O1', :'T1b', :'iss3', 'manual', :'u_ven'), 'denied:42501');

select set_config('test.uid', :'u_clied', false);
select test.check('ext_clied_insert_link',     test.ins_link(:'O1', :'T1b', :'iss3', 'manual', :'u_clied'), 'denied:42501');
select test.check('ext_clied_delete_own_link', test.del('task_github_issue_links', :'L5'), 'ok:0');

select set_config('test.uid', :'u_cliadm', false);
select test.check('ext_cliadm_insert_link', test.ins_link(:'O1', :'T1b', :'iss3', 'manual', :'u_cliadm'), 'denied:42501');
select test.check('ext_cliadm_delete_link', test.del('task_github_issue_links', :'L1'), 'ok:0');

-- 行の org_id を「自分が社内の別 org」にすり替えても O1 のタスク/Issue には紐づけられないこと
select set_config('test.uid', :'u_dual', false);
select test.check('ext_dual_insert_link_other_org_id', test.ins_link(:'O2', :'T1', :'iss3', 'manual', :'u_dual'), 'denied');

-- 二要素認証を登録済みでコード未入力なら書けない／入力済みなら書ける
select set_config('test.uid', :'u_mfa', false);
select set_config('request.jwt.claims', '', false);
select test.check('mfa_aal1_insert_link', test.ins_link(:'O1', :'T1b', :'iss3', 'manual', :'u_mfa'), 'denied:42501');
select set_config('request.jwt.claims', '{"aal":"aal2"}', false);
select test.check('mfa_aal2_insert_link', test.ins_link(:'O1', :'T1b', :'iss3', 'manual', :'u_mfa'), 'ok:1');
select set_config('request.jwt.claims', '', false);

-- -----------------------------------------------------------------------------
-- 書き込み: github_issues / task_github_issue_rollups（書込ポリシーなし = service role のみ）
-- -----------------------------------------------------------------------------
\echo '== write: service-role-only tables =='
select set_config('test.uid', :'u_own', false);
select test.check('int_own_insert_issue', test.try(format(
  'insert into public.github_issues(org_id, github_repo_id, issue_number, title, url, state) values (%L, %L, 99, %L, %L, %L)',
  :'O1', :'R1', 'x', 'https://example.invalid/i/99', 'open')), 'denied:42501');
select test.check('int_own_update_issue', test.upd('github_issues', 'title = ''x''', :'iss1'), 'ok:0');
select test.check('int_own_delete_issue', test.del('github_issues', :'iss1'), 'ok:0');
select test.check('int_own_insert_rollup', test.try(format(
  'insert into public.task_github_issue_rollups(task_id, org_id) values (%L, %L)', :'TM', :'O1')), 'denied:42501');
select test.check('int_own_update_rollup', test.try(format(
  'update public.task_github_issue_rollups set notified_at = now() where task_id = %L', :'T1')), 'ok:0');
select test.check('int_own_delete_rollup', test.try(format(
  'delete from public.task_github_issue_rollups where task_id = %L', :'T1')), 'ok:0');

select set_config('test.uid', :'u_mem', false);
select test.check('int_mem_update_rollup', test.try(format(
  'update public.task_github_issue_rollups set open_count = 0 where task_id = %L', :'T1')), 'ok:0');

select set_config('test.uid', :'u_cli', false);
select test.check('ext_cli_update_issue', test.upd('github_issues', 'title = ''x''', :'iss1'), 'ok:0');

-- -----------------------------------------------------------------------------
-- 集計関数の実行権限: authenticated / anon からは呼べない
-- -----------------------------------------------------------------------------
\echo '== rollup function: execute privilege =='
select set_config('test.uid', :'u_own', false);
select test.check('int_own_call_rollup_fn', test.try(format(
  'select * from public.github_recompute_issue_rollup(%L)', :'T1')), 'denied:42501');
reset role;
set role anon;
select test.check('anon_call_rollup_fn', test.try(format(
  'select * from public.github_recompute_issue_rollup(%L)', :'T1')), 'denied:42501');
reset role;

-- -----------------------------------------------------------------------------
-- 組織一致トリガー: 行の org_id・タスクの org_id・Issue の org_id が全て一致しなければ拒否
--   呼び出した人が両方の組織に属していても（int_both）、RLS を通らない書き手（postgres = service role 相当）でも拒否
-- -----------------------------------------------------------------------------
\echo '== org match trigger =='
set role authenticated;
select set_config('test.uid', :'u_both', false);
select test.check('trg_both_valid_insert',        test.ins_link(:'O1', :'T1b', :'iss3', 'manual', :'u_both'), 'ok:1');
select test.check('trg_both_issue_other_org',     test.ins_link(:'O1', :'T1',  :'iss9', 'manual', :'u_both'), 'denied:P0001');
select test.check('trg_both_task_other_org',      test.ins_link(:'O1', :'T3',  :'iss3', 'manual', :'u_both'), 'denied:P0001');
select test.check('trg_both_row_org_only',        test.ins_link(:'O2', :'T1',  :'iss3', 'manual', :'u_both'), 'denied:P0001');
select test.check('trg_both_row_org_matches_one', test.ins_link(:'O2', :'T3',  :'iss3', 'manual', :'u_both'), 'denied:P0001');
reset role;

select test.check('trg_svc_valid_insert',        test.ins_link(:'O1', :'T1b', :'iss2', 'auto', null), 'ok:1');
select test.check('trg_svc_issue_other_org',     test.ins_link(:'O1', :'T1',  :'iss9', 'auto', null), 'denied:P0001');
select test.check('trg_svc_task_other_org',      test.ins_link(:'O1', :'T3',  :'iss3', 'auto', null), 'denied:P0001');
select test.check('trg_svc_row_org_only',        test.ins_link(:'O2', :'T1',  :'iss3', 'auto', null), 'denied:P0001');
select test.check('trg_svc_missing_issue',       test.ins_link(:'O1', :'T1',  :'iss_none', 'auto', null), 'denied:P0001');
select test.check('trg_svc_update_row_org',      test.upd('task_github_issue_links', format('org_id = %L', :'O2'), :'L1'), 'denied:P0001');
select test.check('trg_svc_update_issue_other',  test.upd('task_github_issue_links', format('github_issue_id = %L', :'iss9'), :'L1'), 'denied:P0001');

-- -----------------------------------------------------------------------------
-- 制約・既定値・updated_at（postgres で実行）
-- -----------------------------------------------------------------------------
\echo '== constraints / defaults =='
select test.check('ck_issue_state', test.try(format(
  'insert into public.github_issues(org_id, github_repo_id, issue_number, title, url, state) values (%L, %L, 50, %L, %L, %L)',
  :'O1', :'R1', 'x', 'https://example.invalid/i/50', 'merged')), 'violation:23514');
select test.check('uq_issue_repo_number', test.try(format(
  'insert into public.github_issues(org_id, github_repo_id, issue_number, title, url, state) values (%L, %L, 1, %L, %L, %L)',
  :'O1', :'R1', 'dup', 'https://example.invalid/i/1', 'open')), 'violation:23505');
select test.check('ck_link_type', test.ins_link(:'O1', :'T1b', :'iss2', 'bogus', null), 'violation:23514');
select test.check('uq_link_task_issue', test.ins_link(:'O1', :'T1', :'iss1', 'auto', null), 'violation:23505');
select test.check('df_issue_defaults', (
  select format('assignees=%s synced=%s created=%s updated=%s',
                assignee_logins::text, (last_synced_at is not null)::text,
                (created_at is not null)::text, (updated_at is not null)::text)
  from public.github_issues where id = :'iss1'), 'assignees={} synced=true created=true updated=true');
update public.github_issues set updated_at = '2000-01-01T00:00:00Z' where id = :'iss1';
select test.check('trg_issue_updated_at_bumped', (
  select (updated_at > '2001-01-01T00:00:00Z'::timestamptz)::text from public.github_issues where id = :'iss1'), 'true');

-- -----------------------------------------------------------------------------
-- 集計関数 github_recompute_issue_rollup そのもの（service_role で呼ぶ。行の確認は postgres）
--   この節だけ紐づけトリガー（集計し直す方）を止め、紐づけの増減も「関数を明示で呼んだとき」の結果として確かめる。
--   トリガー込みの挙動は次の lt_* 節で確かめる。
--   戻り値の表記: <変更前 open>><変更後 open> c=<完了> np=<見送り> ac=<all_closed_at が入っているか> became=<この呼び出しで 1以上→0 になったか>
-- -----------------------------------------------------------------------------
\echo '== rollup function (link trigger disabled) =='
select test.set_link_rollup_trigger(false);

insert into public.github_issues(id, org_id, github_repo_id, issue_number, title, url, state, state_reason) values
  (:'ra',  :'O1', :'R1', 11, 'a',  'https://example.invalid/i/11', 'open',   null),
  (:'rb',  :'O1', :'R1', 12, 'b',  'https://example.invalid/i/12', 'open',   null),
  (:'rc',  :'O1', :'R1', 13, 'c',  'https://example.invalid/i/13', 'closed', 'completed'),
  (:'rd',  :'O1', :'R1', 14, 'd',  'https://example.invalid/i/14', 'closed', 'not_planned'),
  (:'re',  :'O1', :'R1', 15, 'e',  'https://example.invalid/i/15', 'closed', null),
  (:'rf',  :'O1', :'R1', 16, 'f',  'https://example.invalid/i/16', 'closed', 'completed'),
  (:'ru',  :'O1', :'R1', 17, 'u',  'https://example.invalid/i/17', 'open',   null),
  (:'rp1', :'O1', :'R1', 18, 'p1', 'https://example.invalid/i/18', 'open',   null),
  (:'rp2', :'O1', :'R1', 19, 'p2', 'https://example.invalid/i/19', 'closed', 'completed'),
  (:'rdl', :'O1', :'R1', 20, 'dl', 'https://example.invalid/i/20', 'open',   null);

-- 関数が tasks 行を UPDATE しないことの確認用（UPDATE されると xmin が変わる）
select xmin::text as tr_xmin from public.tasks where id = :'TR' \gset

-- step0: 紐づき0件 → 行を作らない
set role service_role;
select test.check('fn_step0_no_links', test.rollup(:'TR'), '0>0 c=0 np=0 ac=false became=false');
reset role;
select test.check('fn_step0_no_row', test.rollup_row(:'TR'), 'no-row');

-- step1: 既に閉じている Issue を後から紐づけ → 「1以上→0」ではないので all_closed_at は入らない（§7.4）
insert into public.task_github_issue_links(org_id, task_id, github_issue_id, link_type) values (:'O1', :'TR', :'rc', 'auto');
set role service_role;
select test.check('fn_step1_attach_closed', test.rollup(:'TR'), '0>0 c=1 np=0 ac=false became=false');
reset role;
select test.check('fn_step1_row', test.rollup_row(:'TR'), 'open=0 c=1 np=0 ac=null');

-- step2: open 2件・見送り1件・state_reason なしで閉じた1件を足す（state_reason なしは「完了」に数える）
insert into public.task_github_issue_links(org_id, task_id, github_issue_id, link_type) values
  (:'O1', :'TR', :'ra', 'auto'), (:'O1', :'TR', :'rb', 'manual'),
  (:'O1', :'TR', :'rd', 'auto'), (:'O1', :'TR', :'re', 'created');
set role service_role;
select test.check('fn_step2_counts', test.rollup(:'TR'), '0>2 c=2 np=1 ac=false became=false');
reset role;
select test.check('fn_step2_row', test.rollup_row(:'TR'), 'open=2 c=2 np=1 ac=null');

-- step3: 1件だけ閉じる → 一部だけ閉じた（all_closed_at は入らない）
update public.github_issues set state = 'closed', state_reason = 'completed', closed_at = now() where id = :'ra';
set role service_role;
select test.check('fn_step3_partial_close', test.rollup(:'TR'), '2>1 c=3 np=1 ac=false became=false');
reset role;

-- PR3 が以前に通知した印を置いておく（関数が notified_at に触らないことを確かめる）
update public.task_github_issue_rollups set notified_at = '2000-01-01T00:00:00Z' where task_id = :'TR';

-- step4: 最後の open を「見送り」で閉じる → 1→0。all_closed_at が入る
update public.github_issues set state = 'closed', state_reason = 'not_planned', closed_at = now() where id = :'rb';
set role service_role;
select test.check('fn_step4_all_closed', test.rollup(:'TR'), '1>0 c=3 np=2 ac=true became=true');
reset role;
select test.check('fn_step4_row', test.rollup_row(:'TR'), 'open=0 c=3 np=2 ac=set');
select all_closed_at as ac4 from public.task_github_issue_rollups where task_id = :'TR' \gset

-- step4b: 変化なしで再計算 → 0→0。all_closed_at は据え置き（戻り値も同じ時刻）
set role service_role;
select test.check('fn_step4b_no_change', test.rollup(:'TR'), '0>0 c=3 np=2 ac=true became=false');
select test.check('fn_step4b_returns_kept_all_closed_at', (
  select (r.all_closed_at_after = :'ac4'::timestamptz)::text
  from public.github_recompute_issue_rollup(:'TR') r), 'true');
reset role;
select test.check('fn_step4b_row_all_closed_kept', (
  select (all_closed_at = :'ac4'::timestamptz)::text from public.task_github_issue_rollups where task_id = :'TR'), 'true');

-- step5: 再オープン → open>0 に戻ったので all_closed_at は null
update public.github_issues set state = 'open', state_reason = 'reopened', closed_at = null where id = :'rb';
set role service_role;
select test.check('fn_step5_reopen', test.rollup(:'TR'), '0>1 c=3 np=1 ac=false became=false');
reset role;
select test.check('fn_step5_row', test.rollup_row(:'TR'), 'open=1 c=3 np=1 ac=null');

-- step6: もう一度全部閉じる → 1→0。all_closed_at は前回より新しい時刻で入る（再通知できる）
update public.github_issues set state = 'closed', state_reason = 'completed', closed_at = now() where id = :'rb';
set role service_role;
select test.check('fn_step6_all_closed_again', test.rollup(:'TR'), '1>0 c=4 np=1 ac=true became=true');
reset role;
select test.check('fn_step6_all_closed_renewed', (
  select (all_closed_at > :'ac4'::timestamptz)::text from public.task_github_issue_rollups where task_id = :'TR'), 'true');
select all_closed_at as ac6 from public.task_github_issue_rollups where task_id = :'TR' \gset

-- step7: 全部閉じたタスクに、閉じた Issue を後から紐づけ → 0→0。all_closed_at は変わらない
insert into public.task_github_issue_links(org_id, task_id, github_issue_id, link_type) values (:'O1', :'TR', :'rf', 'manual');
set role service_role;
select test.check('fn_step7_attach_closed_to_all_closed', test.rollup(:'TR'), '0>0 c=5 np=1 ac=true became=false');
reset role;
select test.check('fn_step7_all_closed_kept', (
  select (all_closed_at = :'ac6'::timestamptz)::text from public.task_github_issue_rollups where task_id = :'TR'), 'true');

-- 関数は notified_at に触らない（通知の先着1回は PR3）
select test.check('fn_notified_at_untouched', (
  select (notified_at = '2000-01-01T00:00:00Z'::timestamptz)::text from public.task_github_issue_rollups where task_id = :'TR'), 'true');
-- 関数は tasks 行を UPDATE しない
select test.check('fn_does_not_update_task', (select xmin::text from public.tasks where id = :'TR'), :'tr_xmin');

-- 解除で紐づきが0件 → 行を消す。戻り値は 1→0 を正直に返すが、all_closed_at は入れず became=false
insert into public.task_github_issue_links(org_id, task_id, github_issue_id, link_type) values (:'O1', :'TU', :'ru', 'manual');
set role service_role;
select test.check('fn_unlink_setup', test.rollup(:'TU'), '0>1 c=0 np=0 ac=false became=false');
reset role;
delete from public.task_github_issue_links where task_id = :'TU' and github_issue_id = :'ru';
set role service_role;
select test.check('fn_unlink_last_open', test.rollup(:'TU'), '1>0 c=0 np=0 ac=false became=false');
reset role;
select test.check('fn_unlink_last_open_row_deleted', test.rollup_row(:'TU'), 'no-row');

-- 解除で open だけが外れ、閉じた Issue が残る（1→0）。決まり「1以上→0 で all_closed_at = now()」どおり入る。
--   原因が解除なので通知しないのは呼び出し側（PR3）の判定。この挙動を固定しておく。
insert into public.task_github_issue_links(org_id, task_id, github_issue_id, link_type) values
  (:'O1', :'TP', :'rp1', 'manual'), (:'O1', :'TP', :'rp2', 'manual');
set role service_role;
select test.check('fn_partial_unlink_setup', test.rollup(:'TP'), '0>1 c=1 np=0 ac=false became=false');
reset role;
delete from public.task_github_issue_links where task_id = :'TP' and github_issue_id = :'rp1';
set role service_role;
select test.check('fn_partial_unlink_rule', test.rollup(:'TP'), '1>0 c=1 np=0 ac=true became=true');
reset role;

-- Issue の削除（紐づけは cascade で消える）で0件 → 行を消す
insert into public.task_github_issue_links(org_id, task_id, github_issue_id, link_type) values (:'O1', :'TD', :'rdl', 'auto');
set role service_role;
select test.check('fn_issue_delete_setup', test.rollup(:'TD'), '0>1 c=0 np=0 ac=false became=false');
reset role;
delete from public.github_issues where id = :'rdl';
set role service_role;
select test.check('fn_issue_delete', test.rollup(:'TD'), '1>0 c=0 np=0 ac=false became=false');
reset role;
select test.check('fn_issue_delete_row_deleted', test.rollup_row(:'TD'), 'no-row');

-- 存在しないタスク → 0行（何もしない）
set role service_role;
select test.check('fn_missing_task', test.rollup(:'T_none'), 'no-row');
reset role;

-- タスクは残っているが組織が先に消えた（組織削除の連鎖の途中を再現）→ エラーにせず 0行。
--   連鎖削除の順番は制約の作成順で決まり、復元などで変わりうるので、順番に頼らないことを確かめる。
insert into public.organizations(id) values (:'O3');
insert into public.spaces(id, org_id, name) values (:'S4', :'O3', 'o3-space');
insert into public.tasks(id, org_id, space_id, title, ball, client_scope) values (:'T4', :'O3', :'S4', 't4', 'internal', 'deliverable');
insert into public.github_repositories(id, org_id, installation_id, repo_id, owner_login, repo_name) values (:'R4', :'O3', 303, 3001, 'o3-gh', 'repo-d');
insert into public.github_issues(id, org_id, github_repo_id, issue_number, title, url, state) values (:'i4', :'O3', :'R4', 1, 'i4', 'https://example.invalid/i/o3-1', 'open');
insert into public.task_github_issue_links(org_id, task_id, github_issue_id, link_type) values (:'O3', :'T4', :'i4', 'auto');
begin;
set local session_replication_role = replica;   -- 外部キーの連鎖を止め、組織の行だけを消す
delete from public.organizations where id = :'O3';
set local session_replication_role = origin;    -- ここからは外部キーを通常どおり確かめる
select test.rollup(:'T4') as org_gone_result \gset
rollback;
select test.check('fn_task_without_org_is_noop', :'org_gone_result', 'no-row');

select test.set_link_rollup_trigger(true);

-- -----------------------------------------------------------------------------
-- 紐づけの追加・削除で集計し直すトリガー（本人の権限の手動紐づけ・service role の自動紐づけの両方）
--   トリガーは戻り値を使わない（= 紐づけ・解除では通知しない）。Issue の状態変化は拾わない（RPC で呼ぶ）。
-- -----------------------------------------------------------------------------
\echo '== link trigger: recompute on insert / delete =='
insert into public.github_issues(id, org_id, github_repo_id, issue_number, title, url, state, state_reason) values
  (:'im1', :'O1', :'R1', 31, 'm1', 'https://example.invalid/i/31', 'open',   null),
  (:'im2', :'O1', :'R1', 32, 'm2', 'https://example.invalid/i/32', 'closed', 'completed'),
  (:'ix1', :'O1', :'R1', 33, 'x1', 'https://example.invalid/i/33', 'open',   null),
  (:'ix2', :'O1', :'R1', 34, 'x2', 'https://example.invalid/i/34', 'closed', 'completed'),
  (:'iy1', :'O1', :'R1', 35, 'y1', 'https://example.invalid/i/35', 'open',   null),
  (:'iy2', :'O1', :'R1', 36, 'y2', 'https://example.invalid/i/36', 'open',   null);
select xmin::text as tm_xmin from public.tasks where id = :'TM' \gset

-- (a) 社内 editor が本人の権限で「閉じた Issue」を手動で紐づけ → 集計行ができる。all_closed_at は入らない
set role authenticated;
select set_config('test.uid', :'u_mem', false);
insert into public.task_github_issue_links(org_id, task_id, github_issue_id, link_type, created_by)
  values (:'O1', :'TM', :'im2', 'manual', :'u_mem');
select test.check('lt_editor_sees_new_rollup', (select count(*) from public.task_github_issue_rollups where task_id = :'TM')::text, '1');
reset role;
select test.check('lt_attach_closed_creates_row', test.rollup_row(:'TM'), 'open=0 c=1 np=0 ac=null');

-- (b) open の Issue を手動で紐づけ → open=1
set role authenticated;
select set_config('test.uid', :'u_mem', false);
insert into public.task_github_issue_links(org_id, task_id, github_issue_id, link_type, created_by)
  values (:'O1', :'TM', :'im1', 'manual', :'u_mem');
reset role;
select test.check('lt_attach_open', test.rollup_row(:'TM'), 'open=1 c=1 np=0 ac=null');

-- (c) open の Issue を本人の権限で解除 → open=0。閉じた Issue が残るので行は残り、決まりどおり all_closed_at が入る
set role authenticated;
select set_config('test.uid', :'u_mem', false);
delete from public.task_github_issue_links where task_id = :'TM' and github_issue_id = :'im1';
reset role;
select test.check('lt_unlink_open', test.rollup_row(:'TM'), 'open=0 c=1 np=0 ac=set');

-- (d) 最後の1件を解除 → 0件なので行が消える
set role authenticated;
select set_config('test.uid', :'u_mem', false);
delete from public.task_github_issue_links where task_id = :'TM' and github_issue_id = :'im2';
reset role;
select test.check('lt_unlink_last_deletes_row', test.rollup_row(:'TM'), 'no-row');

-- (e) トリガーは Issue の状態変化を拾わない。紐づけ後に Issue が閉じたら、RPC の呼び出しで became=true になる
insert into public.task_github_issue_links(org_id, task_id, github_issue_id, link_type) values (:'O1', :'TM', :'im1', 'auto');
select test.check('lt_service_role_link_counts', test.rollup_row(:'TM'), 'open=1 c=0 np=0 ac=null');
update public.github_issues set state = 'closed', state_reason = 'completed', closed_at = now() where id = :'im1';
select test.check('lt_issue_close_not_picked_by_trigger', test.rollup_row(:'TM'), 'open=1 c=0 np=0 ac=null');
set role service_role;
select test.check('lt_issue_close_via_rpc', test.rollup(:'TM'), '1>0 c=1 np=0 ac=true became=true');
reset role;

-- トリガー経由でも tasks 行は変わらない
select test.check('lt_does_not_update_task', (select xmin::text from public.tasks where id = :'TM'), :'tm_xmin');

-- (f) タスクの削除（紐づけと集計行が cascade で消える）でエラーにならない（社内 owner が本人の権限で消す）
insert into public.task_github_issue_links(org_id, task_id, github_issue_id, link_type) values
  (:'O1', :'TX', :'ix1', 'auto'), (:'O1', :'TX', :'ix2', 'auto');
select test.check('lt_task_delete_setup', test.rollup_row(:'TX'), 'open=1 c=1 np=0 ac=null');
set role authenticated;
select set_config('test.uid', :'u_own', false);
select test.check('lt_task_delete_ok', test.try(format('delete from public.tasks where id = %L', :'TX')), 'ok:1');
delete from public.tasks where id = :'TX';
reset role;
select test.check('lt_task_delete_links_gone', (select count(*) from public.task_github_issue_links where task_id = :'TX')::text, '0');
select test.check('lt_task_delete_rollup_gone', test.rollup_row(:'TX'), 'no-row');

-- (g) Issue の削除（紐づけが cascade で消える）で、残ったタスクの集計が正しくなる
--   iy1 は TY と TZ の両方に紐づく（1つの Issue を複数タスクに）
insert into public.task_github_issue_links(org_id, task_id, github_issue_id, link_type) values
  (:'O1', :'TY', :'iy1', 'auto'), (:'O1', :'TY', :'iy2', 'auto'), (:'O1', :'TZ', :'iy1', 'manual');
select test.check('lt_issue_delete_setup_ty', test.rollup_row(:'TY'), 'open=2 c=0 np=0 ac=null');
select test.check('lt_issue_delete_setup_tz', test.rollup_row(:'TZ'), 'open=1 c=0 np=0 ac=null');
select test.check('lt_issue_delete_ok', test.try(format('delete from public.github_issues where id = %L', :'iy1')), 'ok:1');
delete from public.github_issues where id = :'iy1';
select test.check('lt_issue_delete_remaining_task', test.rollup_row(:'TY'), 'open=1 c=0 np=0 ac=null');
select test.check('lt_issue_delete_last_link_task', test.rollup_row(:'TZ'), 'no-row');

-- -----------------------------------------------------------------------------
-- Issue の書き換えと再計算を1回で行う RPC: github_apply_issue_state（service_role で呼ぶ）
--   2つの接続で同時に走らせる確認はランナー（conc_*）で行う。ここは1つの接続での挙動
-- -----------------------------------------------------------------------------
\echo '== apply issue state RPC =='
insert into public.tasks(id, org_id, space_id, title, ball, client_scope) values
  (:'TA1', :'O1', :'S1', 'ta1', 'internal', 'deliverable'),
  (:'TA2', :'O1', :'S1', 'ta2', 'internal', 'deliverable');
insert into public.github_issues(id, org_id, github_repo_id, issue_number, title, url, state) values
  (:'ap41', :'O1', :'R1', 41, 'title-41', 'https://example.invalid/i/41', 'open'),
  (:'ap42', :'O1', :'R1', 42, 'title-42', 'https://example.invalid/i/42', 'open');
insert into public.task_github_issue_links(org_id, task_id, github_issue_id, link_type) values
  (:'O1', :'TA1', :'ap41', 'auto'), (:'O1', :'TA2', :'ap41', 'manual');
select xmin::text as ta1_xmin from public.tasks where id = :'TA1' \gset
select xmin::text as ta2_xmin from public.tasks where id = :'TA2' \gset

-- 紐づくタスクが無い Issue → 0行。Issue の行は作られる
set role service_role;
select test.check('ap_new_issue_no_links', test.apply(:'O1', :'R1', 43, 'open', null, '{}'), 'no-row');
reset role;
select test.check('ap_new_issue_row', (
  select format('%s %s %s', state, coalesce(state_reason, '-'), title) from public.github_issues
  where github_repo_id = :'R1' and issue_number = 43), 'open - title-43');

-- 同じ内容を2回 → どちらも変化なし（冪等）。行は1つのまま・同じ id
set role service_role;
select test.check('ap_idempotent_1', test.apply(:'O1', :'R1', 41, 'open', null, '{}'),
  'f1:1>1 c=0 np=0 ac=false became=false;f2:1>1 c=0 np=0 ac=false became=false');
select test.check('ap_idempotent_2', test.apply(:'O1', :'R1', 41, 'open', null, '{}'),
  'f1:1>1 c=0 np=0 ac=false became=false;f2:1>1 c=0 np=0 ac=false became=false');
reset role;
select test.check('ap_upsert_single_row', (
  select count(*) from public.github_issues where github_repo_id = :'R1' and issue_number = 41)::text, '1');
select test.check('ap_upsert_same_id', (
  select id::text from public.github_issues where github_repo_id = :'R1' and issue_number = 41), :'ap41');

-- 担当の変更 → 件数は変わらない（became=false）。担当は保存される
set role service_role;
select test.check('ap_assignee_change', test.apply(:'O1', :'R1', 41, 'open', null, '{alice,bob}'),
  'f1:1>1 c=0 np=0 ac=false became=false;f2:1>1 c=0 np=0 ac=false became=false');
reset role;
select test.check('ap_assignee_saved', (select assignee_logins::text from public.github_issues where id = :'ap41'), '{alice,bob}');

-- 閉じる → 紐づく2タスクとも 1→0（became=true）／同じ「閉じた」をもう一度 → 0→0（二重に報告しない）／再オープン → 0→1
set role service_role;
select test.check('ap_close', test.apply(:'O1', :'R1', 41, 'closed', 'completed', '{alice,bob}'),
  'f1:1>0 c=1 np=0 ac=true became=true;f2:1>0 c=1 np=0 ac=true became=true');
select test.check('ap_close_duplicate', test.apply(:'O1', :'R1', 41, 'closed', 'completed', '{alice,bob}'),
  'f1:0>0 c=1 np=0 ac=true became=false;f2:0>0 c=1 np=0 ac=true became=false');
select test.check('ap_reopen', test.apply(:'O1', :'R1', 41, 'open', 'reopened', '{alice,bob}'),
  'f1:0>1 c=0 np=0 ac=false became=false;f2:0>1 c=0 np=0 ac=false became=false');
reset role;

-- TA2 にだけ別の open の Issue を足す → 41 を閉じると TA1 は 1→0（became=true）、TA2 は 2→1（became=false）
insert into public.task_github_issue_links(org_id, task_id, github_issue_id, link_type) values (:'O1', :'TA2', :'ap42', 'auto');
set role service_role;
select test.check('ap_close_partial', test.apply(:'O1', :'R1', 41, 'closed', 'completed', '{}'),
  'f1:1>0 c=1 np=0 ac=true became=true;f2:2>1 c=1 np=0 ac=false became=false');
-- 42 を「見送り」で閉じる → TA2 だけ 1→0
select test.check('ap_close_not_planned', test.apply(:'O1', :'R1', 42, 'closed', 'not_planned', '{}'),
  'f2:1>0 c=1 np=1 ac=true became=true');
-- 組織違い（引数の org_id とリポジトリの組織が違う）・知らないリポジトリ・不正な state は拒否し、何も書かない
select test.check('ap_org_mismatch',  test.apply(:'O2', :'R1', 41, 'open', 'reopened', '{}'), 'raised:P0001');
select test.check('ap_unknown_repo',  test.apply(:'O1', :'iss_none', 41, 'open', null, '{}'), 'raised:P0001');
select test.check('ap_invalid_state', test.apply(:'O1', :'R1', 41, 'merged', null, '{}'), 'raised:23514');
reset role;
select test.check('ap_rejected_no_write', (
  select state || ' ' || coalesce(state_reason, '-') from public.github_issues where id = :'ap41'), 'closed completed');
-- tasks 行は変わらない
select test.check('ap_does_not_update_tasks', (
  select string_agg(xmin::text, ',' order by id) from public.tasks where id in (:'TA1', :'TA2')),
  :'ta1_xmin' || ',' || :'ta2_xmin');

-- authenticated / anon からは呼べない
set role authenticated;
select set_config('test.uid', :'u_own', false);
select test.check('ap_authenticated_denied', test.try(format(
  'select * from public.github_apply_issue_state(%L, %L, 41, %L, %L, %L, null, null, null, null, null, null)',
  :'O1', :'R1', 'title-41', 'https://example.invalid/i/41', 'open')), 'denied:42501');
reset role;
set role anon;
select test.check('ap_anon_denied', test.try(format(
  'select * from public.github_apply_issue_state(%L, %L, 41, %L, %L, %L, null, null, null, null, null, null)',
  :'O1', :'R1', 'title-41', 'https://example.invalid/i/41', 'open')), 'denied:42501');
reset role;

-- 古い webhook で巻き戻さない: 引数の github_updated_at が保存済みより「厳密に古い」ときは書き換えず・数え直さない
--   （両方に時刻があるときだけ比べる。同じ時刻なら書き換える。どちらかが null なら今までどおり書き換える）
insert into public.tasks(id, org_id, space_id, title, ball, client_scope) values (:'TA3', :'O1', :'S1', 'ta3', 'internal', 'deliverable');
insert into public.github_issues(id, org_id, github_repo_id, issue_number, title, url, state)
  values (:'ap44', :'O1', :'R1', 44, 'title-44', 'https://example.invalid/i/44', 'open');
insert into public.task_github_issue_links(org_id, task_id, github_issue_id, link_type) values (:'O1', :'TA3', :'ap44', 'auto');

-- 新しい時刻（10:00）で閉じる（保存済みは null なので書き換える）
set role service_role;
select test.check('ap_stale_setup_close', test.apply_at(:'O1', :'R1', 44, 'closed', 'completed', '{}', '2026-09-01T10:00:00Z'),
  'f3:1>0 c=1 np=0 ac=true became=true');
reset role;
select all_closed_at as ac44, updated_at as ru44 from public.task_github_issue_rollups where task_id = :'TA3' \gset

-- 古い時刻（09:00）の「開いている」が遅れて届く → 閉じたまま・became=false・件数は変化なし・数え直さない
set role service_role;
select test.check('ap_stale_open_ignored', test.apply_at(:'O1', :'R1', 44, 'open', null, '{late}', '2026-09-01T09:00:00Z'),
  'f3:0>0 c=1 np=0 ac=true became=false');
reset role;
select test.check('ap_stale_row_unchanged', (
  select format('%s %s %s %s', state, coalesce(state_reason, '-'), assignee_logins::text,
                (github_updated_at = '2026-09-01T10:00:00Z'::timestamptz)::text)
  from public.github_issues where id = :'ap44'), 'closed completed {} true');
select test.check('ap_stale_no_recompute', (
  select ((all_closed_at = :'ac44'::timestamptz) and (updated_at = :'ru44'::timestamptz))::text
  from public.task_github_issue_rollups where task_id = :'TA3'), 'true');

-- 紐づくタスクが無い Issue に古い通知 → 0行・書き換えない（43 は ap_new_issue_no_links で now() の時刻で作った）
set role service_role;
select test.check('ap_stale_no_links', test.apply_at(:'O1', :'R1', 43, 'closed', 'completed', '{}', '2000-01-01T00:00:00Z'), 'no-row');
reset role;
select test.check('ap_stale_no_links_row_unchanged', (
  select state from public.github_issues where github_repo_id = :'R1' and issue_number = 43), 'open');

-- 同じ時刻（11:00）に2通 → 両方反映される（再オープン → 閉じる）
set role service_role;
select test.check('ap_same_time_first', test.apply_at(:'O1', :'R1', 44, 'open', 'reopened', '{alice}', '2026-09-01T11:00:00Z'),
  'f3:0>1 c=0 np=0 ac=false became=false');
select test.check('ap_same_time_second', test.apply_at(:'O1', :'R1', 44, 'closed', 'completed', '{alice,bob}', '2026-09-01T11:00:00Z'),
  'f3:1>0 c=1 np=0 ac=true became=true');
reset role;
select test.check('ap_same_time_row', (
  select format('%s %s', state, assignee_logins::text) from public.github_issues where id = :'ap44'), 'closed {alice,bob}');

-- 引数の時刻が null → 比べずに書き換える（今までどおり。保存済みの時刻も null になる）
set role service_role;
select test.check('ap_null_incoming_applies', test.apply_at(:'O1', :'R1', 44, 'open', 'reopened', '{}', null),
  'f3:0>1 c=0 np=0 ac=false became=false');
reset role;
select test.check('ap_null_incoming_row', (
  select format('%s %s', state, coalesce(github_updated_at::text, 'null')) from public.github_issues where id = :'ap44'), 'open null');
-- 保存済みの時刻が null → 引数が古い時刻（08:00）でも比べずに書き換える
set role service_role;
select test.check('ap_null_stored_applies', test.apply_at(:'O1', :'R1', 44, 'closed', 'completed', '{}', '2026-09-01T08:00:00Z'),
  'f3:1>0 c=1 np=0 ac=true became=true');
reset role;
select test.check('ap_null_stored_row', (
  select format('%s %s', state, (github_updated_at = '2026-09-01T08:00:00Z'::timestamptz)::text)
  from public.github_issues where id = :'ap44'), 'closed true');

-- -----------------------------------------------------------------------------
-- 連鎖削除（実際に消す。最後に置く）
-- -----------------------------------------------------------------------------
\echo '== cascade (destructive, last) =='
delete from auth.users where id = :'u_mem';
select test.check('casc_user_delete_sets_null', (
  select coalesce(created_by::text, 'null') from public.task_github_issue_links where id = :'L1'), 'null');
delete from public.tasks where id = :'T1b';
select test.check('casc_task_delete_links', (select count(*) from public.task_github_issue_links where task_id = :'T1b')::text, '0');
delete from public.github_issues where id = :'iss3';
select test.check('casc_issue_delete_links', (select count(*) from public.task_github_issue_links where github_issue_id = :'iss3')::text, '0');
delete from public.github_repositories where id = :'R3';
select test.check('casc_repo_delete_issues', (select count(*) from public.github_issues where github_repo_id = :'R3')::text, '0');
select test.check('casc_repo_delete_links', (select count(*) from public.task_github_issue_links where id = :'L4')::text, '0');
select test.check('casc_task_delete_rollup_setup', (select count(*) from public.task_github_issue_rollups where task_id = :'T1')::text, '1');
delete from public.tasks where id = :'T1';
select test.check('casc_task_delete_rollup', (select count(*) from public.task_github_issue_rollups where task_id = :'T1')::text, '0');

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
    raise exception 'GITHUB ISSUES LINK CHECKS FAILED (% failures)', v_fail;
  end if;
end $$;
select 'GITHUB ISSUES LINK CHECKS PASSED' as result;
