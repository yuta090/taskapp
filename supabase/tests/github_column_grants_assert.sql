-- =============================================================================
-- GitHub の PR・Issue の列の見える範囲（列ごとの権限）・接続状態 RPC・未使用列の削除 の挙動検証
-- 前提: run_github_column_grants.sh が baseline → 実 migration（20260911080909 まで）→ 本 migration を
--   verbatim 適用済み（RED=1 のときは本 migration だけ適用しない）。
--
-- データの形は github_visibility_connector_only_assert.sql と同じ（行の見え方は応急処置のまま）:
--   O1: S1（R1 を紐づけ）/ S2（R2）/ S3（紐づけなし）。インストール I1 = 101（接続者 con・2026-01-01）
--       I1b = 102（接続者 con2・2026-02-01）。R1〜R3 は 101、R4 は 102。
--   O2: S4（R5）。インストール I2 = 101（接続者 o2・2026-03-01）。
--   O3: インストールなし（社内 member の o3 だけ）… 未接続の組織。
--   タスク T1（S1）に P1 と IS1 を紐づけ済み。
--
-- 視点:
--   con      接続者（O1 owner・I1 を接続・S1 admin）
--   own2     別の owner（接続者ではない・S3 admin）
--   mem      space のメンバー（O1 member・S1 editor）
--   memout   space 外の member（O1 member・S3 editor）
--   cli      client（org=client ＋ S1 space=client）
--   ven      vendor（org=client ＋ S1 space=vendor）
--   con2     別のインストール I1b の接続者（O1 member・space なし）
--   o2       別組織 O2 の接続者（O2 owner・S4 editor）
--   o3       未接続の組織 O3 の member
--   nouid    authenticated だがログイン中の利用者が無い
--   anon     未ログイン（公開キー）
--   service  service_role（RLS を通らない）
--
-- label:
--   chg_*    本 migration で結果が変わるもの（適用前は FAIL・適用後は PASS であるべき）
--   same_*   適用前後で結果が同じであるべきもの（両方で PASS）
-- 出力: PASS[label] / FAIL[label]。最後に FAIL が 0 件なら "GITHUB COLUMN GRANTS CHECKS PASSED"。
--   1件でもあれば例外で終了する。
-- 読み書きは test.try / test.val がサブトランザクション内で実行し、必ず巻き戻す（各 assert は独立）。
-- =============================================================================
set client_min_messages = notice;
set timezone = 'UTC';

\set O1 '00000000-0000-0000-0000-0000000000a1'
\set O2 '00000000-0000-0000-0000-0000000000a2'
\set O3 '00000000-0000-0000-0000-0000000000a3'
\set S1 '00000000-0000-0000-0000-0000000000b1'
\set S2 '00000000-0000-0000-0000-0000000000b2'
\set S3 '00000000-0000-0000-0000-0000000000b3'
\set S4 '00000000-0000-0000-0000-0000000000b4'
\set u_con    '00000000-0000-0000-0000-0000000000c1'
\set u_own2   '00000000-0000-0000-0000-0000000000c2'
\set u_mem    '00000000-0000-0000-0000-0000000000c3'
\set u_memout '00000000-0000-0000-0000-0000000000c4'
\set u_cli    '00000000-0000-0000-0000-0000000000c5'
\set u_ven    '00000000-0000-0000-0000-0000000000c6'
\set u_con2   '00000000-0000-0000-0000-0000000000c7'
\set u_o2     '00000000-0000-0000-0000-0000000000c8'
\set u_o3     '00000000-0000-0000-0000-0000000000c9'
\set T1  '00000000-0000-0000-0000-0000000000d1'
\set T1b '00000000-0000-0000-0000-0000000000d2'
\set I1  '00000000-0000-0000-0000-000000000a01'
\set I1b '00000000-0000-0000-0000-000000000a02'
\set I2  '00000000-0000-0000-0000-000000000a03'
\set R1 '00000000-0000-0000-0000-0000000000e1'
\set R2 '00000000-0000-0000-0000-0000000000e2'
\set R3 '00000000-0000-0000-0000-0000000000e3'
\set R4 '00000000-0000-0000-0000-0000000000e4'
\set R5 '00000000-0000-0000-0000-0000000000e5'
\set SG1 '00000000-0000-0000-0000-000000000b01'
\set SG2 '00000000-0000-0000-0000-000000000b02'
\set SG5 '00000000-0000-0000-0000-000000000b05'
\set P1 '00000000-0000-0000-0000-0000000000f1'
\set P2 '00000000-0000-0000-0000-0000000000f2'
\set P3 '00000000-0000-0000-0000-0000000000f3'
\set P4 '00000000-0000-0000-0000-0000000000f4'
\set P5 '00000000-0000-0000-0000-0000000000f5'
\set IS1 '00000000-0000-0000-0000-000000001001'
\set IS2 '00000000-0000-0000-0000-000000001002'
\set IS3 '00000000-0000-0000-0000-000000001003'
\set IS4 '00000000-0000-0000-0000-000000001004'
\set IS5 '00000000-0000-0000-0000-000000001005'
\set K1   '00000000-0000-0000-0000-000000000c01'
\set ISL1 '00000000-0000-0000-0000-000000000c11'

-- 画面（hooks）が並べて取る、読んでよい列
\set PR_COLS 'id, org_id, github_repo_id, pr_number, pr_title, pr_state, additions, deletions, commits_count, merged_at, closed_at, pr_created_at, updated_at'
\set ISSUE_COLS 'id, org_id, github_repo_id, issue_number, title, state, state_reason, issue_created_at, closed_at, github_updated_at, last_synced_at, created_at, updated_at'

-- -----------------------------------------------------------------------------
-- 検証ヘルパ
-- -----------------------------------------------------------------------------
create schema if not exists test;
grant usage on schema test to authenticated, service_role, anon;
create table test.results (seq serial primary key, label text, ok boolean, got text, want text);

-- 結果の記録（definer: authenticated / anon / service_role 視点のままでも記録できる）
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

-- 呼び出し元の権限（= 列の権限・RLS が効く）で SQL を実行し、行数を返して必ず巻き戻す。
--   ok:<行数> / denied:42501（権限・RLS の拒否）/ denied:P0001（既存トリガーの拒否）/ error:<その他>
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
    return 'error:' || v_state || ':' || v_msg;
  end;
end $$;

-- 呼び出し元の権限で SQL（1列を返すもの）を実行し、1行目の値を文字列で返して必ず巻き戻す。
--   行が無い・値が null なら '(null)'。拒否は denied:42501、その他のエラーは error:<SQLSTATE>:<文言>
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
    raise exception 'test_rollback' using errcode = 'TR001', detail = coalesce(v, '(null)');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate,
                            v_detail = pg_exception_detail,
                            v_msg = message_text;
    if v_state = 'TR001' then return v_detail; end if;
    if v_state = '42501' then return 'denied:' || v_state; end if;
    return 'error:' || v_state || ':' || v_msg;
  end;
end $$;

-- ロールが select できる列 / できない列（列の並び順）。無ければ '-'
create or replace function test.readable_cols(p_role text, p_table regclass)
returns text language sql as $$
  select coalesce(string_agg(a.attname::text, ',' order by a.attnum), '-')
    from pg_attribute a
   where a.attrelid = p_table and a.attnum > 0 and not a.attisdropped
     and has_column_privilege(p_role, p_table, a.attnum, 'select');
$$;
create or replace function test.hidden_cols(p_role text, p_table regclass)
returns text language sql as $$
  select coalesce(string_agg(a.attname::text, ',' order by a.attnum), '-')
    from pg_attribute a
   where a.attrelid = p_table and a.attnum > 0 and not a.attisdropped
     and not has_column_privilege(p_role, p_table, a.attnum, 'select');
$$;

-- 接続状態 RPC の1行目（connected|connected_by|connected_at|is_me）と行数
create or replace function test.rpc_row(p_org uuid)
returns text language sql security invoker as $$
  select test.val(format(
    $q$select concat_ws('|', connected::text, coalesce(connected_by::text, '-'), coalesce(connected_at::text, '-'), is_me::text)
         from public.github_connection_status(%L)$q$, p_org));
$$;
create or replace function test.rpc_rows(p_org uuid)
returns text language sql security invoker as $$
  select test.val(format($q$select count(*)::text from public.github_connection_status(%L)$q$, p_org));
$$;

-- PostgREST の埋め込み（task_github_links → github_pull_requests(<読んでよい列>, github_repositories(full_name))）
-- と同じ形の問い合わせ。紐づけごとに「PR のタイトル/リポジトリ名」を返す（見えない所は (none)）
create or replace function test.embed_prs()
returns text language sql security invoker as $$
  select test.val($q$
    select string_agg(coalesce(e.pr ->> 'pr_title', '(none)') || '/' || coalesce(e.pr -> 'github_repositories' ->> 'full_name', '(none)'),
                      ',' order by e.id)
      from (
        select l.id, row_to_json(sub.*)::jsonb as pr
          from public.task_github_links l
          left join lateral (
            select p.id, p.org_id, p.github_repo_id, p.pr_number, p.pr_title, p.pr_state, p.additions, p.deletions,
                   p.commits_count, p.merged_at, p.closed_at, p.pr_created_at, p.updated_at,
                   (select row_to_json(r_sub.*) from (select r.full_name from public.github_repositories r
                                                       where r.id = p.github_repo_id) r_sub) as github_repositories
              from public.github_pull_requests p
             where p.id = l.github_pr_id
          ) sub on true
      ) e
  $q$);
$$;

-- 同じ埋め込みを全列（*）で取る形
create or replace function test.embed_prs_star()
returns text language sql security invoker as $$
  select test.val($q$
    select count(*)::text
      from public.task_github_links l
      left join lateral (select p.* from public.github_pull_requests p where p.id = l.github_pr_id) sub on true
  $q$);
$$;

-- task_github_issue_links → github_issues(<読んでよい列>) の埋め込み
create or replace function test.embed_issues()
returns text language sql security invoker as $$
  select test.val($q$
    select string_agg(coalesce(e.issue ->> 'title', '(none)') || ':' || coalesce(e.issue ->> 'state', '(none)'), ',' order by e.id)
      from (
        select l.id, row_to_json(sub.*)::jsonb as issue
          from public.task_github_issue_links l
          left join lateral (
            select i.id, i.org_id, i.github_repo_id, i.issue_number, i.title, i.state, i.state_reason,
                   i.issue_created_at, i.closed_at, i.github_updated_at, i.last_synced_at, i.created_at, i.updated_at
              from public.github_issues i
             where i.id = l.github_issue_id
          ) sub on true
      ) e
  $q$);
$$;

create or replace function test.embed_issues_star()
returns text language sql security invoker as $$
  select test.val($q$
    select count(*)::text
      from public.task_github_issue_links l
      left join lateral (select i.* from public.github_issues i where i.id = l.github_issue_id) sub on true
  $q$);
$$;

-- 読める列だけで一覧を取ったとき / 全列（*）で取ったとき / 読めない列を1つ取ったとき
create or replace function test.check_reads(p_who text, p_pr int, p_issue int, p_cols_pr text, p_cols_issue text)
returns void language plpgsql security invoker as $$
begin
  perform test.check('chg_' || p_who || '_pr_select_star',     test.try('select * from public.github_pull_requests'), 'denied:42501');
  perform test.check('same_' || p_who || '_pr_allowed_cols',   test.try(format('select %s from public.github_pull_requests', p_cols_pr)), 'ok:' || p_pr);
  perform test.check('chg_' || p_who || '_issue_select_star',  test.try('select * from public.github_issues'), 'denied:42501');
  perform test.check('same_' || p_who || '_issue_allowed_cols', test.try(format('select %s from public.github_issues', p_cols_issue)), 'ok:' || p_issue);
end $$;

create or replace function test.check_hidden(p_who text)
returns void language plpgsql security invoker as $$
declare
  c text;
begin
  foreach c in array array['pr_url', 'head_branch', 'base_branch', 'author_login', 'author_avatar_url'] loop
    perform test.check('chg_' || p_who || '_pr_hidden_' || c,
      test.try(format('select %I from public.github_pull_requests', c)), 'denied:42501');
  end loop;
  foreach c in array array['url', 'author_login', 'assignee_logins'] loop
    perform test.check('chg_' || p_who || '_issue_hidden_' || c,
      test.try(format('select %I from public.github_issues', c)), 'denied:42501');
  end loop;
  -- 読めない列で絞り込むこともできない
  perform test.check('chg_' || p_who || '_pr_filter_hidden',
    test.try('select id from public.github_pull_requests where author_login is not null'), 'denied:42501');
  perform test.check('chg_' || p_who || '_issue_filter_hidden',
    test.try('select id from public.github_issues where url is not null'), 'denied:42501');
end $$;

-- -----------------------------------------------------------------------------
-- データ（postgres で投入。RLS は通らない）
-- -----------------------------------------------------------------------------
insert into public.organizations(id) values (:'O1'), (:'O2'), (:'O3');
insert into public.spaces(id, org_id, name) values
  (:'S1', :'O1', 'customer-a'),
  (:'S2', :'O1', 'customer-b'),
  (:'S3', :'O1', 'no-repo'),
  (:'S4', :'O2', 'o2-space');
insert into auth.users(id) values
  (:'u_con'), (:'u_own2'), (:'u_mem'), (:'u_memout'),
  (:'u_cli'), (:'u_ven'), (:'u_con2'), (:'u_o2'), (:'u_o3');

insert into public.org_memberships(org_id, user_id, role) values
  (:'O1', :'u_con',    'owner'),
  (:'O1', :'u_own2',   'owner'),
  (:'O1', :'u_mem',    'member'),
  (:'O1', :'u_memout', 'member'),
  (:'O1', :'u_cli',    'client'),
  (:'O1', :'u_ven',    'client'),   -- vendor 招待の受諾結果は org=client（20260706004313）
  (:'O1', :'u_con2',   'member'),
  (:'O2', :'u_o2',     'owner'),
  (:'O3', :'u_o3',     'member');
insert into public.space_memberships(space_id, user_id, role) values
  (:'S1', :'u_con',    'admin'),
  (:'S3', :'u_own2',   'admin'),
  (:'S1', :'u_mem',    'editor'),
  (:'S3', :'u_memout', 'editor'),
  (:'S1', :'u_cli',    'client'),
  (:'S1', :'u_ven',    'vendor'),
  (:'S4', :'u_o2',     'editor');

insert into public.tasks(id, org_id, space_id, title, ball, client_scope) values
  (:'T1',  :'O1', :'S1', 't1',  'internal', 'deliverable'),
  (:'T1b', :'O1', :'S1', 't1b', 'internal', 'deliverable');

insert into public.github_installations(id, org_id, installation_id, account_login, created_by, created_at) values
  (:'I1',  :'O1', 101, 'gh-a', :'u_con',  '2026-01-01 00:00:00+00'),
  (:'I1b', :'O1', 102, 'gh-b', :'u_con2', '2026-02-01 00:00:00+00'),
  (:'I2',  :'O2', 101, 'gh-a', :'u_o2',   '2026-03-01 00:00:00+00');
insert into public.github_repositories(id, org_id, installation_id, repo_id, owner_login, repo_name) values
  (:'R1', :'O1', 101, 1001, 'gh-a', 'repo-1'),
  (:'R2', :'O1', 101, 1002, 'gh-a', 'repo-2'),
  (:'R3', :'O1', 101, 1003, 'gh-a', 'repo-3'),
  (:'R4', :'O1', 102, 2001, 'gh-b', 'repo-4'),
  (:'R5', :'O2', 101, 1001, 'gh-a', 'repo-1');
insert into public.space_github_repos(id, org_id, space_id, github_repo_id, created_by) values
  (:'SG1', :'O1', :'S1', :'R1', :'u_con'),
  (:'SG2', :'O1', :'S2', :'R2', :'u_con'),
  (:'SG5', :'O2', :'S4', :'R5', :'u_o2');
insert into public.github_pull_requests(id, org_id, github_repo_id, pr_number, pr_title, pr_url, pr_state,
                                        author_login, author_avatar_url, head_branch, base_branch, pr_created_at) values
  (:'P1', :'O1', :'R1', 1, 'pr-1', 'https://example.invalid/pr/1', 'open', 'dev-1', 'https://example.invalid/a/1.png', 'feature/1', 'main', now()),
  (:'P2', :'O1', :'R2', 2, 'pr-2', 'https://example.invalid/pr/2', 'open', 'dev-2', 'https://example.invalid/a/2.png', 'feature/2', 'main', now()),
  (:'P3', :'O1', :'R3', 3, 'pr-3', 'https://example.invalid/pr/3', 'open', 'dev-3', 'https://example.invalid/a/3.png', 'feature/3', 'main', now()),
  (:'P4', :'O1', :'R4', 4, 'pr-4', 'https://example.invalid/pr/4', 'open', 'dev-4', 'https://example.invalid/a/4.png', 'feature/4', 'main', now()),
  (:'P5', :'O2', :'R5', 5, 'pr-5', 'https://example.invalid/pr/5', 'open', 'dev-5', 'https://example.invalid/a/5.png', 'feature/5', 'main', now());
insert into public.github_issues(id, org_id, github_repo_id, issue_number, title, url, state, author_login, assignee_logins) values
  (:'IS1', :'O1', :'R1', 1, 'issue-1', 'https://example.invalid/issue/1', 'open', 'dev-1', '{dev-9}'),
  (:'IS2', :'O1', :'R2', 2, 'issue-2', 'https://example.invalid/issue/2', 'open', 'dev-2', '{dev-9}'),
  (:'IS3', :'O1', :'R3', 3, 'issue-3', 'https://example.invalid/issue/3', 'open', 'dev-3', '{dev-9}'),
  (:'IS4', :'O1', :'R4', 4, 'issue-4', 'https://example.invalid/issue/4', 'open', 'dev-4', '{dev-9}'),
  (:'IS5', :'O2', :'R5', 5, 'issue-5', 'https://example.invalid/issue/5', 'open', 'dev-5', '{dev-9}');
insert into public.task_github_links(id, org_id, task_id, github_pr_id, link_type, created_by) values
  (:'K1', :'O1', :'T1', :'P1', 'manual', :'u_mem');
insert into public.task_github_issue_links(id, org_id, task_id, github_issue_id, link_type, created_by) values
  (:'ISL1', :'O1', :'T1', :'IS1', 'manual', :'u_mem');

-- -----------------------------------------------------------------------------
-- 形: 表・列の権限（postgres で確認）
-- -----------------------------------------------------------------------------
\echo '== shape: table / column privileges =='
select test.check('chg_shape_pr_table_select',
  'authenticated=' || has_table_privilege('authenticated', 'public.github_pull_requests', 'select')::text
  || ',anon=' || has_table_privilege('anon', 'public.github_pull_requests', 'select')::text
  || ',service_role=' || has_table_privilege('service_role', 'public.github_pull_requests', 'select')::text,
  'authenticated=false,anon=false,service_role=true');
select test.check('chg_shape_issue_table_select',
  'authenticated=' || has_table_privilege('authenticated', 'public.github_issues', 'select')::text
  || ',anon=' || has_table_privilege('anon', 'public.github_issues', 'select')::text
  || ',service_role=' || has_table_privilege('service_role', 'public.github_issues', 'select')::text,
  'authenticated=false,anon=false,service_role=true');

select test.check('chg_shape_pr_cols_authenticated', test.readable_cols('authenticated', 'public.github_pull_requests'),
  'id,org_id,github_repo_id,pr_number,pr_title,pr_state,additions,deletions,commits_count,merged_at,closed_at,pr_created_at,updated_at');
select test.check('chg_shape_pr_hidden_cols_authenticated', test.hidden_cols('authenticated', 'public.github_pull_requests'),
  'pr_url,author_login,author_avatar_url,head_branch,base_branch');
select test.check('chg_shape_pr_cols_anon', test.readable_cols('anon', 'public.github_pull_requests'), '-');
select test.check('same_shape_pr_cols_service_role', test.readable_cols('service_role', 'public.github_pull_requests'),
  'id,org_id,github_repo_id,pr_number,pr_title,pr_url,pr_state,author_login,author_avatar_url,head_branch,base_branch,'
  'additions,deletions,commits_count,merged_at,closed_at,pr_created_at,updated_at');

select test.check('chg_shape_issue_cols_authenticated', test.readable_cols('authenticated', 'public.github_issues'),
  'id,org_id,github_repo_id,issue_number,title,state,state_reason,issue_created_at,closed_at,github_updated_at,last_synced_at,created_at,updated_at');
select test.check('chg_shape_issue_hidden_cols_authenticated', test.hidden_cols('authenticated', 'public.github_issues'),
  'url,author_login,assignee_logins');
select test.check('chg_shape_issue_cols_anon', test.readable_cols('anon', 'public.github_issues'), '-');
select test.check('same_shape_issue_cols_service_role', test.readable_cols('service_role', 'public.github_issues'),
  'id,org_id,github_repo_id,issue_number,title,url,state,state_reason,author_login,assignee_logins,issue_created_at,'
  'closed_at,github_updated_at,last_synced_at,created_at,updated_at');

-- insert / update / delete の表の権限は変えない（authenticated は書込ポリシーが無いので書けないまま）
select test.check('same_shape_write_privileges', (
  select string_agg(format('%s.%s:insert=%s,update=%s,delete=%s', t, r,
           has_table_privilege(r, t, 'insert')::text, has_table_privilege(r, t, 'update')::text,
           has_table_privilege(r, t, 'delete')::text), ';' order by t, r)
    from unnest(array['public.github_pull_requests', 'public.github_issues']) t
   cross join unnest(array['anon', 'authenticated', 'service_role']) r
), 'public.github_issues.anon:insert=true,update=true,delete=true;'
   'public.github_issues.authenticated:insert=true,update=true,delete=true;'
   'public.github_issues.service_role:insert=true,update=true,delete=true;'
   'public.github_pull_requests.anon:insert=true,update=true,delete=true;'
   'public.github_pull_requests.authenticated:insert=true,update=true,delete=true;'
   'public.github_pull_requests.service_role:insert=true,update=true,delete=true');

-- 行の絞り込み（20260911080909 のポリシー）は変えない
select test.check('same_shape_pr_issue_policies', (
  select string_agg(tablename || ':' || cmd || ':' || policyname, ',' order by tablename, policyname) from pg_policies
  where schemaname = 'public' and permissive = 'PERMISSIVE' and tablename in ('github_pull_requests', 'github_issues')
), 'github_issues:SELECT:linked space members or connector can view issues,'
   'github_pull_requests:SELECT:linked space members or connector can view PRs');

-- -----------------------------------------------------------------------------
-- 形: github_installations の未使用列の削除
-- -----------------------------------------------------------------------------
\echo '== shape: github_installations columns =='
select test.check('chg_shape_installations_token_columns', (
  select count(*) from pg_attribute
  where attrelid = 'public.github_installations'::regclass and attnum > 0 and not attisdropped
    and attname in ('access_token', 'token_expires_at')
)::text, '0');
select test.check('same_shape_installations_other_columns', (
  select string_agg(attname::text, ',' order by attnum) from pg_attribute
  where attrelid = 'public.github_installations'::regclass and attnum > 0 and not attisdropped
    and attname not in ('access_token', 'token_expires_at')
), 'id,org_id,installation_id,account_login,account_type,created_by,created_at,updated_at,permissions,permissions_updated_at');

-- -----------------------------------------------------------------------------
-- 形: 接続状態 RPC（SECURITY DEFINER・stable・search_path 固定・返す列・実行できるロール）
-- -----------------------------------------------------------------------------
\echo '== shape: github_connection_status =='
select test.check('chg_shape_rpc', (
  select string_agg(p.proname || ':definer=' || p.prosecdef::text || ':volatile=' || p.provolatile
                    || ':' || coalesce(array_to_string(p.proconfig, ';'), '-')
                    || ':args=' || pg_get_function_identity_arguments(p.oid)
                    || ':returns=' || pg_get_function_result(p.oid), ',')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'github_connection_status'
), 'github_connection_status:definer=true:volatile=s:search_path=public:args=p_org uuid:'
   'returns=TABLE(connected boolean, connected_by uuid, connected_at timestamp with time zone, is_me boolean)');
select test.check('chg_shape_rpc_execute', (
  select string_agg('authenticated=' || has_function_privilege('authenticated', p.oid, 'execute')::text
                    || ',service_role=' || has_function_privilege('service_role', p.oid, 'execute')::text
                    || ',anon=' || has_function_privilege('anon', p.oid, 'execute')::text
                    || ',public=' || exists(
                         select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                         where x.grantee = 0 and x.privilege_type = 'EXECUTE')::text, ',')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'github_connection_status'
), 'authenticated=true,service_role=true,anon=false,public=false');

-- -----------------------------------------------------------------------------
-- 読み取り: 視点ごと（行の数は応急処置の範囲のまま。列は読んでよい列だけ）
-- -----------------------------------------------------------------------------
set role authenticated;

\echo '== read: connector (every row of own installation) =='
select set_config('test.uid', :'u_con', false);
select test.check_reads('con', 3, 3, :'PR_COLS', :'ISSUE_COLS');
select test.check_hidden('con');
select test.check('same_con_pr_values', test.val(
  'select string_agg(pr_number || '':'' || pr_title || '':'' || pr_state, '','' order by pr_number) from public.github_pull_requests'),
  '1:pr-1:open,2:pr-2:open,3:pr-3:open');
select test.check('same_con_issue_values', test.val(
  'select string_agg(issue_number || '':'' || title || '':'' || state, '','' order by issue_number) from public.github_issues'),
  '1:issue-1:open,2:issue-2:open,3:issue-3:open');
-- どの space にも紐づかないリポジトリ（R3）の行も、接続者には見える
select test.check('same_con_pr_unlinked_repo', test.try(format(
  'select %s from public.github_pull_requests where github_repo_id = %L', :'PR_COLS', :'R3')), 'ok:1');
select test.check('same_con_installations_select_star', test.try('select * from public.github_installations'), 'ok:1');

\echo '== read: space member (S1 editor, S1 has R1) =='
select set_config('test.uid', :'u_mem', false);
select test.check_reads('mem', 1, 1, :'PR_COLS', :'ISSUE_COLS');
select test.check_hidden('mem');
select test.check('same_mem_pr_values', test.val(
  'select string_agg(pr_number || '':'' || pr_title || '':'' || pr_state, '','' order by pr_number) from public.github_pull_requests'),
  '1:pr-1:open');
select test.check('same_mem_issue_values', test.val(
  'select string_agg(issue_number || '':'' || title || '':'' || state, '','' order by issue_number) from public.github_issues'),
  '1:issue-1:open');
select test.check('same_mem_pr_unlinked_repo', test.try(format(
  'select %s from public.github_pull_requests where github_repo_id = %L', :'PR_COLS', :'R3')), 'ok:0');
select test.check('same_mem_installations_select_star', test.try('select * from public.github_installations'), 'ok:0');

\echo '== read: other viewpoints (row counts unchanged, * denied) =='
select set_config('test.uid', :'u_own2', false);
select test.check_reads('own2', 0, 0, :'PR_COLS', :'ISSUE_COLS');
select set_config('test.uid', :'u_memout', false);
select test.check_reads('memout', 0, 0, :'PR_COLS', :'ISSUE_COLS');
select set_config('test.uid', :'u_cli', false);
select test.check_reads('cli', 0, 0, :'PR_COLS', :'ISSUE_COLS');
select set_config('test.uid', :'u_ven', false);
select test.check_reads('ven', 0, 0, :'PR_COLS', :'ISSUE_COLS');
select set_config('test.uid', :'u_con2', false);
select test.check_reads('con2', 1, 1, :'PR_COLS', :'ISSUE_COLS');
select set_config('test.uid', :'u_o2', false);
select test.check_reads('o2', 1, 1, :'PR_COLS', :'ISSUE_COLS');
select set_config('test.uid', '', false);
select test.check_reads('nouid', 0, 0, :'PR_COLS', :'ISSUE_COLS');

-- -----------------------------------------------------------------------------
-- 埋め込み: タスクの紐づけから PR・Issue を読んでよい列だけで取る（画面の hooks と同じ形）
--   リポジトリ名は接続者にだけ見える（20260911080909 のまま）。それ以外は (none)
-- -----------------------------------------------------------------------------
\echo '== embed: task links -> PR / Issue =='
select set_config('test.uid', :'u_mem', false);
select test.check('same_mem_embed_pr_allowed',   test.embed_prs(), 'pr-1/(none)');
select test.check('chg_mem_embed_pr_star',       test.embed_prs_star(), 'denied:42501');
select test.check('same_mem_embed_issue_allowed', test.embed_issues(), 'issue-1:open');
select test.check('chg_mem_embed_issue_star',    test.embed_issues_star(), 'denied:42501');

select set_config('test.uid', :'u_con', false);
select test.check('same_con_embed_pr_allowed',   test.embed_prs(), 'pr-1/gh-a/repo-1');
select test.check('chg_con_embed_pr_star',       test.embed_prs_star(), 'denied:42501');
select test.check('same_con_embed_issue_allowed', test.embed_issues(), 'issue-1:open');

-- -----------------------------------------------------------------------------
-- 書き込み: authenticated は PR・Issue の行を書けないまま／タスクへの紐づけは従来どおり
--   （task_github_links の組織一致トリガーは呼び出した人の権限で PR の org_id を読む）
-- -----------------------------------------------------------------------------
\echo '== write: authenticated =='
select set_config('test.uid', :'u_con', false);
select test.check('same_con_pr_insert', test.try(format(
  $q$insert into public.github_pull_requests(org_id, github_repo_id, pr_number, pr_title, pr_url, pr_state, pr_created_at)
     values (%L, %L, 99, 'x', 'https://example.invalid/pr/99', 'open', now())$q$, :'O1', :'R1')), 'denied:42501');
select test.check('same_con_pr_update', test.try(format(
  $q$update public.github_pull_requests set pr_title = 'x' where id = %L$q$, :'P1')), 'ok:0');
select test.check('same_con_pr_delete', test.try(format(
  $q$delete from public.github_pull_requests where id = %L$q$, :'P1')), 'ok:0');
select test.check('same_con_issue_insert', test.try(format(
  $q$insert into public.github_issues(org_id, github_repo_id, issue_number, title, url, state)
     values (%L, %L, 99, 'x', 'https://example.invalid/issue/99', 'open')$q$, :'O1', :'R1')), 'denied:42501');
select test.check('same_con_issue_update', test.try(format(
  $q$update public.github_issues set title = 'x' where id = %L$q$, :'IS1')), 'ok:0');
select test.check('same_con_issue_delete', test.try(format(
  $q$delete from public.github_issues where id = %L$q$, :'IS1')), 'ok:0');

select set_config('test.uid', :'u_mem', false);
select test.check('same_mem_insert_pr_link', test.try(format(
  $q$insert into public.task_github_links(org_id, task_id, github_pr_id, link_type, created_by)
     values (%L, %L, %L, 'manual', %L)$q$, :'O1', :'T1b', :'P1', :'u_mem')), 'ok:1');
select test.check('same_mem_insert_issue_link', test.try(format(
  $q$insert into public.task_github_issue_links(org_id, task_id, github_issue_id, link_type, created_by)
     values (%L, %L, %L, 'manual', %L)$q$, :'O1', :'T1b', :'IS1', :'u_mem')), 'ok:1');

-- -----------------------------------------------------------------------------
-- 接続状態 RPC: github_connection_status(組織)
--   社内メンバー: 1行（connected|connected_by|connected_at|is_me）
--     インストールが複数あるときは、呼んだ人が接続したものを優先し、無ければいちばん古いもの
--   client・vendor・組織外・未ログイン: 0行
-- -----------------------------------------------------------------------------
\echo '== rpc: github_connection_status =='
select set_config('test.uid', :'u_con', false);
select test.check('chg_rpc_con',  test.rpc_row(:'O1'), format('true|%s|2026-01-01 00:00:00+00|true', :'u_con'));
select test.check('chg_rpc_con_other_org', test.rpc_rows(:'O2'), '0');
select set_config('test.uid', :'u_con2', false);
select test.check('chg_rpc_con2', test.rpc_row(:'O1'), format('true|%s|2026-02-01 00:00:00+00|true', :'u_con2'));
select set_config('test.uid', :'u_mem', false);
select test.check('chg_rpc_mem',  test.rpc_row(:'O1'), format('true|%s|2026-01-01 00:00:00+00|false', :'u_con'));
select set_config('test.uid', :'u_own2', false);
select test.check('chg_rpc_own2', test.rpc_row(:'O1'), format('true|%s|2026-01-01 00:00:00+00|false', :'u_con'));
select set_config('test.uid', :'u_memout', false);
select test.check('chg_rpc_memout', test.rpc_row(:'O1'), format('true|%s|2026-01-01 00:00:00+00|false', :'u_con'));
select set_config('test.uid', :'u_cli', false);
select test.check('chg_rpc_cli',  test.rpc_rows(:'O1'), '0');
select set_config('test.uid', :'u_ven', false);
select test.check('chg_rpc_ven',  test.rpc_rows(:'O1'), '0');
select set_config('test.uid', :'u_o2', false);
select test.check('chg_rpc_o2_other_org', test.rpc_rows(:'O1'), '0');
select test.check('chg_rpc_o2_own_org',   test.rpc_row(:'O2'), format('true|%s|2026-03-01 00:00:00+00|true', :'u_o2'));
select set_config('test.uid', :'u_o3', false);
select test.check('chg_rpc_o3_not_connected', test.rpc_row(:'O3'), 'false|-|-|false');
select set_config('test.uid', '', false);
select test.check('chg_rpc_nouid', test.rpc_rows(:'O1'), '0');

-- 接続者が client に変わったら、その人には0行（接続状態も社内メンバーにだけ返す）
reset role;
update public.org_memberships set role = 'client' where org_id = :'O1' and user_id = :'u_con2';
set role authenticated;
select set_config('test.uid', :'u_con2', false);
select test.check('chg_rpc_con2_demoted', test.rpc_rows(:'O1'), '0');
reset role;
update public.org_memberships set role = 'member' where org_id = :'O1' and user_id = :'u_con2';

-- -----------------------------------------------------------------------------
-- anon: PR・Issue は読めない（適用前も RLS の判定関数を実行できず拒否）・RPC は実行できない
-- -----------------------------------------------------------------------------
\echo '== anon =='
set role anon;
select set_config('test.uid', '', false);
select test.check('same_anon_pr_select_id',    test.try('select id from public.github_pull_requests'), 'denied');
select test.check('same_anon_issue_select_id', test.try('select id from public.github_issues'), 'denied');
select test.check('chg_anon_rpc', test.try(format('select * from public.github_connection_status(%L)', :'O1')), 'denied:42501');
reset role;

-- -----------------------------------------------------------------------------
-- service_role: 全列を読み書きできる（Webhook 受信・照合 cron に影響なし）
-- -----------------------------------------------------------------------------
\echo '== service_role =='
set role service_role;
select test.check('same_service_pr_select_star', test.try('select * from public.github_pull_requests'), 'ok:5');
select test.check('same_service_pr_hidden_values', test.val(format(
  $q$select concat_ws('|', pr_url, head_branch, base_branch, author_login, author_avatar_url)
       from public.github_pull_requests where id = %L$q$, :'P1')),
  'https://example.invalid/pr/1|feature/1|main|dev-1|https://example.invalid/a/1.png');
select test.check('same_service_issue_select_star', test.try('select * from public.github_issues'), 'ok:5');
select test.check('same_service_issue_hidden_values', test.val(format(
  $q$select concat_ws('|', url, author_login, array_to_string(assignee_logins, ','))
       from public.github_issues where id = %L$q$, :'IS1')),
  'https://example.invalid/issue/1|dev-1|dev-9');
select test.check('same_service_installations_select_star', test.try('select * from public.github_installations'), 'ok:3');
select test.check('same_service_pr_update', test.try(format(
  $q$update public.github_pull_requests set pr_title = 'x', pr_url = 'https://example.invalid/x' where id = %L$q$, :'P1')), 'ok:1');
select test.check('same_service_apply_issue_state', test.try(format(
  $q$select * from public.github_apply_issue_state(%L, %L, 99, 't', 'https://example.invalid/issue/99', 'open', null,
       'dev-1', '{}', now(), null, now())$q$, :'O1', :'R1')), 'ok:0');
-- service_role は組織のメンバーではないので0行（実行はできる）
select test.check('chg_service_rpc', test.try(format('select * from public.github_connection_status(%L)', :'O1')), 'ok:0');
reset role;

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
    raise exception 'GITHUB COLUMN GRANTS CHECKS FAILED (% failures)', v_fail;
  end if;
end $$;
select 'GITHUB COLUMN GRANTS CHECKS PASSED' as result;
