-- =============================================================================
-- GitHub 連携の見える範囲（接続した本人だけ）の挙動検証
-- 前提: run_github_visibility_connector_only.sh が baseline → 実 migration を verbatim 適用済み。
--
-- 組織 O1: S1（お客さんA）に R1、S2（お客さんB）に R2 を紐づけ。S3 はリポジトリの紐づけなし。
-- 別組織 O2: S4 に R5 を紐づけ。
-- インストール: I1  = O1 の 101（接続者 u_con）
--               I1b = O1 の 102（接続者 u_con2）
--               I2  = O2 の 101（接続者 u_o2。同じ GitHub のインストールを別の組織でも登録した形）
-- リポジトリ:   R1・R2・R3 = O1/101（R3 はどの space にも紐づけなし）
--               R4 = O1/102（紐づけなし）/ R5 = O2/101
--
-- 視点:
--   con      接続者（O1 owner・I1 を接続・S1 admin。S2 のメンバーではない）
--   own2     別の owner（O1 owner・接続者ではない・S3 admin）
--   mem      space のメンバー（O1 member・S1 editor）
--   memout   space 外の member（O1 member・紐づけの無い S3 の editor）
--   cli      client（org=client ＋ S1 space=client）
--   ven      vendor（org=client ＋ S1 space=vendor：rpc_accept_invite の実マッピング）
--   con2     別のインストール I1b の接続者（O1 member・space なし）… インストール単位で分かれることの確認
--   o2       別組織 O2 の接続者（O2 owner・S4 editor）… 組織をまたがないことの確認
--   service  service_role（RLS を通らない）
--
-- label:
--   chg_*    本 migration で結果が変わるもの（適用前は FAIL・適用後は PASS であるべき）
--   same_*   適用前後で結果が同じであるべきもの（両方で PASS）
-- 出力: PASS[label] / FAIL[label]。最後に FAIL が 0 件なら "GITHUB VISIBILITY CHECKS PASSED"。
--   1件でもあれば例外で終了する。
-- 書き込み系は test.try がサブトランザクション内で実行し必ず巻き戻す（各 assert は独立）。
-- =============================================================================
set client_min_messages = notice;

\set O1 '00000000-0000-0000-0000-0000000000a1'
\set O2 '00000000-0000-0000-0000-0000000000a2'
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
\set K1 '00000000-0000-0000-0000-000000000c01'

-- -----------------------------------------------------------------------------
-- 検証ヘルパ
-- -----------------------------------------------------------------------------
create schema if not exists test;
grant usage on schema test to authenticated, service_role;
create table test.results (seq serial primary key, label text, ok boolean, got text, want text);

-- 結果の記録（definer: authenticated / service_role 視点のままでも記録できる）
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
--   ok:<影響行数> / denied:42501（RLS 拒否）/ denied:P0001（既存トリガーの拒否）/ error:<その他>
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

-- 呼び出し元の視点で見える行数
create or replace function test.cnt(p_table text, p_where text default 'true')
returns text language plpgsql security invoker as $$
declare
  v bigint;
begin
  execute format('select count(*) from public.%I where %s', p_table, p_where) into v;
  return v::text;
end $$;

-- 6表の見える行数をまとめて記録する（全て同じ label 接頭辞のとき用）
create or replace function test.check_counts(p_who text, p_inst int, p_repo int, p_hook int, p_sgr int, p_pr int, p_issue int)
returns void language plpgsql security invoker as $$
begin
  perform test.check(p_who || '_installations',  test.cnt('github_installations'),  p_inst::text);
  perform test.check(p_who || '_repositories',   test.cnt('github_repositories'),   p_repo::text);
  perform test.check(p_who || '_webhook_events', test.cnt('github_webhook_events'), p_hook::text);
  perform test.check(p_who || '_space_repos',    test.cnt('space_github_repos'),    p_sgr::text);
  perform test.check(p_who || '_pull_requests',  test.cnt('github_pull_requests'),  p_pr::text);
  perform test.check(p_who || '_issues',         test.cnt('github_issues'),         p_issue::text);
end $$;

-- 指定した組織の行が6表あわせて何行見えるか
create or replace function test.org_rows(p_org uuid)
returns text language sql security invoker as $$
  select ((select count(*) from public.github_installations  where org_id = p_org)
        + (select count(*) from public.github_repositories   where org_id = p_org)
        + (select count(*) from public.github_webhook_events where org_id = p_org)
        + (select count(*) from public.space_github_repos    where org_id = p_org)
        + (select count(*) from public.github_pull_requests  where org_id = p_org)
        + (select count(*) from public.github_issues         where org_id = p_org))::text;
$$;

-- アプリの POST /api/github/spaces と同じく insert 後に行を読み返す（returning）
create or replace function test.ins_space_repo(p_org uuid, p_space uuid, p_repo uuid, p_by uuid)
returns text language sql as $$
  select test.try(format(
    'insert into public.space_github_repos(org_id, space_id, github_repo_id, created_by) values (%L, %L, %L, %L) returning id',
    p_org, p_space, p_repo, p_by));
$$;

create or replace function test.ins_link(p_org uuid, p_task uuid, p_pr uuid, p_by uuid)
returns text language sql as $$
  select test.try(format(
    'insert into public.task_github_links(org_id, task_id, github_pr_id, link_type, created_by) values (%L, %L, %L, %L, %L)',
    p_org, p_task, p_pr, 'manual', p_by));
$$;

create or replace function test.del(p_table text, p_id uuid)
returns text language sql as $$
  select test.try(format('delete from public.%I where id = %L', p_table, p_id));
$$;

create or replace function test.upd(p_table text, p_set text, p_id uuid)
returns text language sql as $$
  select test.try(format('update public.%I set %s where id = %L', p_table, p_set, p_id));
$$;

-- -----------------------------------------------------------------------------
-- データ（postgres で投入。RLS は通らない）
-- -----------------------------------------------------------------------------
insert into public.organizations(id) values (:'O1'), (:'O2');
insert into public.spaces(id, org_id, name) values
  (:'S1', :'O1', 'customer-a'),
  (:'S2', :'O1', 'customer-b'),
  (:'S3', :'O1', 'no-repo'),
  (:'S4', :'O2', 'o2-space');
insert into auth.users(id) values
  (:'u_con'), (:'u_own2'), (:'u_mem'), (:'u_memout'),
  (:'u_cli'), (:'u_ven'), (:'u_con2'), (:'u_o2');

insert into public.org_memberships(org_id, user_id, role) values
  (:'O1', :'u_con',    'owner'),
  (:'O1', :'u_own2',   'owner'),
  (:'O1', :'u_mem',    'member'),
  (:'O1', :'u_memout', 'member'),
  (:'O1', :'u_cli',    'client'),
  (:'O1', :'u_ven',    'client'),   -- vendor 招待の受諾結果は org=client（20260706004313）
  (:'O1', :'u_con2',   'member'),
  (:'O2', :'u_o2',     'owner');
insert into public.space_memberships(space_id, user_id, role) values
  (:'S1', :'u_con',    'admin'),
  (:'S3', :'u_own2',   'admin'),
  (:'S1', :'u_mem',    'editor'),
  (:'S3', :'u_memout', 'editor'),
  (:'S1', :'u_cli',    'client'),
  (:'S1', :'u_ven',    'vendor'),   -- vendor 招待の受諾結果は space=vendor
  (:'S4', :'u_o2',     'editor');

insert into public.tasks(id, org_id, space_id, title, ball, client_scope) values
  (:'T1',  :'O1', :'S1', 't1',  'internal', 'deliverable'),
  (:'T1b', :'O1', :'S1', 't1b', 'internal', 'deliverable');

insert into public.github_installations(id, org_id, installation_id, account_login, created_by) values
  (:'I1',  :'O1', 101, 'gh-a', :'u_con'),
  (:'I1b', :'O1', 102, 'gh-b', :'u_con2'),
  (:'I2',  :'O2', 101, 'gh-a', :'u_o2');
insert into public.github_repositories(id, org_id, installation_id, repo_id, owner_login, repo_name) values
  (:'R1', :'O1', 101, 1001, 'gh-a', 'repo-1'),
  (:'R2', :'O1', 101, 1002, 'gh-a', 'repo-2'),
  (:'R3', :'O1', 101, 1003, 'gh-a', 'repo-3'),
  (:'R4', :'O1', 102, 2001, 'gh-b', 'repo-4'),
  (:'R5', :'O2', 101, 1001, 'gh-a', 'repo-1');
-- SG2 は「接続者がもう S2 のメンバーではない」形（作成後に抜けた）
insert into public.space_github_repos(id, org_id, space_id, github_repo_id, created_by) values
  (:'SG1', :'O1', :'S1', :'R1', :'u_con'),
  (:'SG2', :'O1', :'S2', :'R2', :'u_con'),
  (:'SG5', :'O2', :'S4', :'R5', :'u_o2');
insert into public.github_pull_requests(id, org_id, github_repo_id, pr_number, pr_title, pr_url, pr_state, pr_created_at) values
  (:'P1', :'O1', :'R1', 1, 'pr-1', 'https://example.invalid/pr/1', 'open', now()),
  (:'P2', :'O1', :'R2', 2, 'pr-2', 'https://example.invalid/pr/2', 'open', now()),
  (:'P3', :'O1', :'R3', 3, 'pr-3', 'https://example.invalid/pr/3', 'open', now()),
  (:'P4', :'O1', :'R4', 4, 'pr-4', 'https://example.invalid/pr/4', 'open', now()),
  (:'P5', :'O2', :'R5', 5, 'pr-5', 'https://example.invalid/pr/5', 'open', now());
insert into public.github_issues(id, org_id, github_repo_id, issue_number, title, url, state) values
  (:'IS1', :'O1', :'R1', 1, 'issue-1', 'https://example.invalid/issue/1', 'open'),
  (:'IS2', :'O1', :'R2', 2, 'issue-2', 'https://example.invalid/issue/2', 'open'),
  (:'IS3', :'O1', :'R3', 3, 'issue-3', 'https://example.invalid/issue/3', 'open'),
  (:'IS4', :'O1', :'R4', 4, 'issue-4', 'https://example.invalid/issue/4', 'open'),
  (:'IS5', :'O2', :'R5', 5, 'issue-5', 'https://example.invalid/issue/5', 'open');
insert into public.task_github_links(id, org_id, task_id, github_pr_id, link_type, created_by) values
  (:'K1', :'O1', :'T1', :'P1', 'manual', :'u_mem');
insert into public.github_webhook_events(org_id, installation_id, event_type, payload) values
  (:'O1', 101, 'pull_request', '{}'::jsonb),
  (:'O1', 102, 'pull_request', '{}'::jsonb),
  (:'O2', 101, 'pull_request', '{}'::jsonb),
  (null,  101, 'installation', '{}'::jsonb);   -- 組織を特定できなかった受信（誰にも見えない）

-- -----------------------------------------------------------------------------
-- 読み取り: 視点ごとの見える行数
--   installations / repositories / webhook_events = 接続者（そのインストールの）だけ
--   space_repos = 社内 かつ その space のメンバー（変更なし）
--   pull_requests / issues = 社内 かつ（紐づいた space のメンバー または そのインストールの接続者）
-- -----------------------------------------------------------------------------
set role authenticated;

\echo '== read: connector (installed 101 in O1, S1 admin) =='
select set_config('test.uid', :'u_con', false);
select test.check('chg_con_installations',  test.cnt('github_installations'),  '1');
select test.check('chg_con_repositories',   test.cnt('github_repositories'),   '3');
select test.check('chg_con_webhook_events', test.cnt('github_webhook_events'), '1');
select test.check('same_con_space_repos',   test.cnt('space_github_repos'),    '1');
select test.check('chg_con_pull_requests',  test.cnt('github_pull_requests'),  '3');
select test.check('chg_con_issues',         test.cnt('github_issues'),         '3');
-- 自分が接続したインストールの行は、紐づけの有無に関係なく全部見える
select test.check('same_con_own_repositories',
  test.cnt('github_repositories', format('org_id = %L and installation_id = 101', :'O1')), '3');
select test.check('same_con_own_pull_requests',
  test.cnt('github_pull_requests', format('github_repo_id in (%L, %L, %L)', :'R1', :'R2', :'R3')), '3');
select test.check('same_con_own_issues',
  test.cnt('github_issues', format('github_repo_id in (%L, %L, %L)', :'R1', :'R2', :'R3')), '3');
select test.check('same_con_unlinked_repo_pr',    test.cnt('github_pull_requests', format('github_repo_id = %L', :'R3')), '1');
select test.check('same_con_unlinked_repo_issue', test.cnt('github_issues',        format('github_repo_id = %L', :'R3')), '1');
select test.check('same_con_no_o2_rows', test.org_rows(:'O2'), '0');

\echo '== read: another owner (not the connector, S3 admin) =='
select set_config('test.uid', :'u_own2', false);
select test.check('chg_own2_installations',  test.cnt('github_installations'),  '0');
select test.check('chg_own2_repositories',   test.cnt('github_repositories'),   '0');
select test.check('chg_own2_webhook_events', test.cnt('github_webhook_events'), '0');
select test.check('same_own2_space_repos',   test.cnt('space_github_repos'),    '0');
select test.check('chg_own2_pull_requests',  test.cnt('github_pull_requests'),  '0');
select test.check('chg_own2_issues',         test.cnt('github_issues'),         '0');

\echo '== read: space member (S1 editor, S1 has R1) =='
select set_config('test.uid', :'u_mem', false);
select test.check('chg_mem_installations',  test.cnt('github_installations'),  '0');
select test.check('chg_mem_repositories',   test.cnt('github_repositories'),   '0');
select test.check('same_mem_webhook_events', test.cnt('github_webhook_events'), '0');
select test.check('same_mem_space_repos',   test.cnt('space_github_repos'),    '1');
select test.check('chg_mem_pull_requests',  test.cnt('github_pull_requests'),  '1');
select test.check('chg_mem_issues',         test.cnt('github_issues'),         '1');
-- 自分の space に紐づいた R1 の行は見える／別の space の R2・どこにも紐づかない R3 は見えない
select test.check('same_mem_linked_repo_pr',       test.cnt('github_pull_requests', format('github_repo_id = %L', :'R1')), '1');
select test.check('same_mem_linked_repo_issue',    test.cnt('github_issues',        format('github_repo_id = %L', :'R1')), '1');
select test.check('chg_mem_other_space_repo_pr',   test.cnt('github_pull_requests', format('github_repo_id = %L', :'R2')), '0');
select test.check('chg_mem_unlinked_repo_pr',      test.cnt('github_pull_requests', format('github_repo_id = %L', :'R3')), '0');
select test.check('chg_mem_unlinked_repo_issue',   test.cnt('github_issues',        format('github_repo_id = %L', :'R3')), '0');
select test.check('same_mem_task_links',           test.cnt('task_github_links'), '1');

\echo '== read: member outside the linked spaces (S3 editor) =='
select set_config('test.uid', :'u_memout', false);
select test.check('chg_memout_installations',   test.cnt('github_installations'),  '0');
select test.check('chg_memout_repositories',    test.cnt('github_repositories'),   '0');
select test.check('same_memout_webhook_events', test.cnt('github_webhook_events'), '0');
select test.check('same_memout_space_repos',    test.cnt('space_github_repos'),    '0');
select test.check('chg_memout_pull_requests',   test.cnt('github_pull_requests'),  '0');
select test.check('chg_memout_issues',          test.cnt('github_issues'),         '0');

\echo '== read: client / vendor (all 0, unchanged) =='
select set_config('test.uid', :'u_cli', false);
select test.check_counts('same_cli', 0, 0, 0, 0, 0, 0);
select set_config('test.uid', :'u_ven', false);
select test.check_counts('same_ven', 0, 0, 0, 0, 0, 0);

\echo '== read: connector of another installation in the same org (102, member, no space) =='
select set_config('test.uid', :'u_con2', false);
select test.check('chg_con2_installations',  test.cnt('github_installations'),  '1');
select test.check('chg_con2_repositories',   test.cnt('github_repositories'),   '1');
select test.check('chg_con2_webhook_events', test.cnt('github_webhook_events'), '1');
select test.check('same_con2_space_repos',   test.cnt('space_github_repos'),    '0');
select test.check('chg_con2_pull_requests',  test.cnt('github_pull_requests'),  '1');
select test.check('chg_con2_issues',         test.cnt('github_issues'),         '1');

\echo '== read: connector in another org (O2 owner, same GitHub installation id 101) =='
select set_config('test.uid', :'u_o2', false);
select test.check_counts('same_o2', 1, 1, 1, 1, 1, 1);
select test.check('same_o2_no_o1_rows', test.org_rows(:'O1'), '0');

\echo '== read: connector demoted to client sees nothing =='
reset role;
update public.org_memberships set role = 'client' where org_id = :'O1' and user_id = :'u_con2';
set role authenticated;
select set_config('test.uid', :'u_con2', false);
select test.check_counts('same_con2_demoted', 0, 0, 0, 0, 0, 0);
reset role;
update public.org_memberships set role = 'member' where org_id = :'O1' and user_id = :'u_con2';

\echo '== read: service_role sees every row (unchanged) =='
set role service_role;
select test.check_counts('same_service', 3, 5, 4, 3, 5, 5);
reset role;

-- -----------------------------------------------------------------------------
-- 二要素認証の RESTRICTIVE ポリシーが残っていること（接続者でも aal1 なら 0 行）
-- -----------------------------------------------------------------------------
\echo '== mfa restrictive policy still applies =='
insert into auth.mfa_factors(user_id, status) values (:'u_con', 'verified');
set role authenticated;
select set_config('test.uid', :'u_con', false);
select set_config('request.jwt.claims', '{"aal":"aal1"}', false);
select test.check('same_mfa_con_aal1_repositories',  test.cnt('github_repositories'),  '0');
select test.check('same_mfa_con_aal1_pull_requests', test.cnt('github_pull_requests'), '0');
select set_config('request.jwt.claims', '{"aal":"aal2"}', false);
select test.check('same_mfa_con_aal2_own_repositories',
  test.cnt('github_repositories', format('org_id = %L and installation_id = 101', :'O1')), '3');
reset role;
select set_config('request.jwt.claims', '', false);
delete from auth.mfa_factors where user_id = :'u_con';

-- -----------------------------------------------------------------------------
-- 書き込み: space_github_repos
--   insert / delete = そのリポジトリのインストールの接続者 かつ その space のメンバー かつ 社内
--   update = ポリシーなし
-- -----------------------------------------------------------------------------
set role authenticated;
\echo '== write: space_github_repos =='
select set_config('test.uid', :'u_con', false);
select test.check('same_con_insert_space_repo',           test.ins_space_repo(:'O1', :'S1', :'R2', :'u_con'), 'ok:1');
select test.check('same_con_insert_space_repo_outside',   test.ins_space_repo(:'O1', :'S2', :'R3', :'u_con'), 'denied');
select test.check('chg_con_insert_space_repo_other_inst', test.ins_space_repo(:'O1', :'S1', :'R4', :'u_con'), 'denied');
select test.check('same_con_delete_space_repo',           test.del('space_github_repos', :'SG1'), 'ok:1');
select test.check('same_con_delete_space_repo_outside',   test.del('space_github_repos', :'SG2'), 'ok:0');
select test.check('chg_con_update_space_repo',            test.upd('space_github_repos', 'sync_prs = false', :'SG1'), 'ok:0');

select set_config('test.uid', :'u_mem', false);
select test.check('chg_mem_insert_space_repo', test.ins_space_repo(:'O1', :'S1', :'R2', :'u_mem'), 'denied');
select test.check('chg_mem_update_space_repo', test.upd('space_github_repos', 'sync_prs = false', :'SG1'), 'ok:0');
select test.check('chg_mem_delete_space_repo', test.del('space_github_repos', :'SG1'), 'ok:0');

select set_config('test.uid', :'u_own2', false);
select test.check('chg_own2_insert_space_repo', test.ins_space_repo(:'O1', :'S3', :'R1', :'u_own2'), 'denied');

select set_config('test.uid', :'u_memout', false);
select test.check('chg_memout_insert_space_repo', test.ins_space_repo(:'O1', :'S3', :'R1', :'u_memout'), 'denied');

select set_config('test.uid', :'u_cli', false);
select test.check('same_cli_insert_space_repo', test.ins_space_repo(:'O1', :'S1', :'R2', :'u_cli'), 'denied');

select set_config('test.uid', :'u_ven', false);
select test.check('same_ven_insert_space_repo', test.ins_space_repo(:'O1', :'S1', :'R2', :'u_ven'), 'denied');

-- -----------------------------------------------------------------------------
-- 書き込み: github_installations（delete = org owner だけ・insert/update はポリシーなし）
--           github_repositories（書き込みポリシーなし）
-- -----------------------------------------------------------------------------
\echo '== write: installations / repositories =='
select set_config('test.uid', :'u_con', false);
select test.check('chg_con_update_installation', test.upd('github_installations', 'account_login = ''x''', :'I1'), 'ok:0');
select test.check('chg_con_insert_installation', test.try(format(
  'insert into public.github_installations(org_id, installation_id, account_login, created_by) values (%L, 999, %L, %L)',
  :'O1', 'x', :'u_con')), 'denied:42501');
select test.check('same_con_delete_installation', test.del('github_installations', :'I1'), 'ok:1');
select test.check('chg_con_update_repository', test.upd('github_repositories', 'default_branch = ''dev''', :'R1'), 'ok:0');
select test.check('chg_con_insert_repository', test.try(format(
  'insert into public.github_repositories(org_id, installation_id, repo_id, owner_login, repo_name) values (%L, 101, 9999, %L, %L)',
  :'O1', 'gh-a', 'repo-x')), 'denied:42501');

select set_config('test.uid', :'u_own2', false);
select test.check('chg_own2_update_installation', test.upd('github_installations', 'account_login = ''x''', :'I1'), 'ok:0');
select test.check('chg_own2_delete_installation', test.del('github_installations', :'I1'), 'ok:0');
select test.check('chg_own2_delete_repository',   test.del('github_repositories', :'R1'), 'ok:0');

select set_config('test.uid', :'u_mem', false);
select test.check('same_mem_delete_installation', test.del('github_installations', :'I1'), 'ok:0');

select set_config('test.uid', :'u_con2', false);
select test.check('same_con2_delete_installation', test.del('github_installations', :'I1b'), 'ok:0');

-- -----------------------------------------------------------------------------
-- 書き込み: task_github_links（ポリシーは変えない。組織一致トリガーが呼び出した人の見える PR を読むため、
--   見えない PR への紐づけは拒否される）
-- -----------------------------------------------------------------------------
\echo '== write: task_github_links (policies unchanged) =='
select set_config('test.uid', :'u_mem', false);
select test.check('same_mem_insert_link_visible_pr', test.ins_link(:'O1', :'T1b', :'P1', :'u_mem'), 'ok:1');
select test.check('chg_mem_insert_link_hidden_pr',   test.ins_link(:'O1', :'T1b', :'P3', :'u_mem'), 'denied');

-- -----------------------------------------------------------------------------
-- ポリシー単体の確認: 既存トリガー（組織一致チェック）を止めても RLS 自体が拒否すること
--   トリガーは呼び出し元の権限で github_* を読むため、上の denied は P0001（トリガー）で返ることがある。
--   ここでは session_replication_role=replica でトリガーを止め、RLS の判定だけを見る。
-- -----------------------------------------------------------------------------
\echo '== policy only (triggers disabled) =='
reset role;
set session_replication_role = replica;
set role authenticated;

select set_config('test.uid', :'u_con', false);
select test.check('same_nt_con_insert_space_repo',            test.ins_space_repo(:'O1', :'S1', :'R2', :'u_con'), 'ok:1');
select test.check('same_nt_con_insert_space_repo_outside',    test.ins_space_repo(:'O1', :'S2', :'R3', :'u_con'), 'denied:42501');
select test.check('chg_nt_con_insert_space_repo_other_inst',  test.ins_space_repo(:'O1', :'S1', :'R4', :'u_con'), 'denied:42501');

select set_config('test.uid', :'u_mem', false);
select test.check('chg_nt_mem_insert_space_repo',  test.ins_space_repo(:'O1', :'S1', :'R2', :'u_mem'), 'denied:42501');

select set_config('test.uid', :'u_own2', false);
select test.check('chg_nt_own2_insert_space_repo', test.ins_space_repo(:'O1', :'S3', :'R1', :'u_own2'), 'denied:42501');

reset role;
set session_replication_role = origin;

-- -----------------------------------------------------------------------------
-- 形: ポリシー・補助関数・索引
-- -----------------------------------------------------------------------------
\echo '== shape =='
select test.check('chg_shape_installations_policies', (
  select string_agg(cmd || ':' || policyname, ',' order by cmd, policyname) from pg_policies
  where schemaname = 'public' and tablename = 'github_installations' and permissive = 'PERMISSIVE'
), 'DELETE:org owners can delete installations,SELECT:connector can view installations');
select test.check('chg_shape_repositories_policies', (
  select string_agg(cmd || ':' || policyname, ',' order by cmd, policyname) from pg_policies
  where schemaname = 'public' and tablename = 'github_repositories' and permissive = 'PERMISSIVE'
), 'SELECT:connector can view repositories');
select test.check('chg_shape_webhook_events_policies', (
  select string_agg(cmd || ':' || policyname, ',' order by cmd, policyname) from pg_policies
  where schemaname = 'public' and tablename = 'github_webhook_events' and permissive = 'PERMISSIVE'
), 'SELECT:connector can view webhook events');
select test.check('chg_shape_space_repos_policies', (
  select string_agg(cmd || ':' || policyname, ',' order by cmd, policyname) from pg_policies
  where schemaname = 'public' and tablename = 'space_github_repos' and permissive = 'PERMISSIVE'
), 'DELETE:connector space members can unlink repos,INSERT:connector space members can link repos,SELECT:internal space members can view repo links');
select test.check('chg_shape_pull_requests_policies', (
  select string_agg(cmd || ':' || policyname, ',' order by cmd, policyname) from pg_policies
  where schemaname = 'public' and tablename = 'github_pull_requests' and permissive = 'PERMISSIVE'
), 'SELECT:linked space members or connector can view PRs');
select test.check('chg_shape_issues_policies', (
  select string_agg(cmd || ':' || policyname, ',' order by cmd, policyname) from pg_policies
  where schemaname = 'public' and tablename = 'github_issues' and permissive = 'PERMISSIVE'
), 'SELECT:linked space members or connector can view issues');

-- 各ポリシーの条件（名前だけでなく中身も）
select test.check('chg_shape_policy_conditions', (
  select count(*) from pg_policies
  where schemaname = 'public' and permissive = 'PERMISSIVE' and (
       (tablename in ('github_installations', 'github_repositories', 'github_webhook_events') and cmd = 'SELECT'
          and qual like '%app_is_github_connector(org_id, installation_id)%')
    or (tablename in ('github_pull_requests', 'github_issues') and cmd = 'SELECT'
          and qual like '%app_is_org_internal(org_id)%' and qual like '%app_can_see_github_repo(github_repo_id)%')
    or (tablename = 'space_github_repos' and cmd = 'INSERT'
          and with_check like '%app_is_org_internal(org_id)%' and with_check like '%app_is_space_member(space_id)%'
          and with_check like '%app_is_github_connector(%')
    or (tablename = 'space_github_repos' and cmd = 'DELETE'
          and qual like '%app_is_org_internal(org_id)%' and qual like '%app_is_space_member(space_id)%'
          and qual like '%app_is_github_connector(%')
    or (tablename = 'github_installations' and cmd = 'DELETE' and qual like '%''owner''%')
  ))::text, '8');

-- 変えない表のポリシー（task_github_links / task_github_issue_links / task_github_issue_rollups）
select test.check('same_shape_unchanged_tables_policies', (
  select string_agg(tablename || ':' || cmd || ':' || policyname, ',' order by tablename, cmd, policyname) from pg_policies
  where schemaname = 'public' and permissive = 'PERMISSIVE'
    and tablename in ('task_github_links', 'task_github_issue_links', 'task_github_issue_rollups')
), 'task_github_issue_links:DELETE:link creators or space admins can delete task issue links,'
   'task_github_issue_links:INSERT:space editors can create task issue links,'
   'task_github_issue_links:SELECT:internal space members can view task issue links,'
   'task_github_issue_rollups:SELECT:internal space members can view issue rollups,'
   'task_github_links:DELETE:link creators or space admins can delete,'
   'task_github_links:INSERT:space editors can create task links,'
   'task_github_links:SELECT:internal space members can view task links');

-- 二要素認証の RESTRICTIVE は GitHub の全表に残っている
select test.check('same_shape_mfa_restrictive_kept', (
  select count(*) from pg_policies
  where schemaname = 'public' and policyname = 'mfa_required_when_enrolled' and permissive = 'RESTRICTIVE'
    and tablename in ('github_installations', 'github_repositories', 'github_webhook_events', 'space_github_repos',
                      'github_pull_requests', 'github_issues', 'task_github_links',
                      'task_github_issue_links', 'task_github_issue_rollups')
)::text, '9');

-- 補助関数: SECURITY DEFINER・stable・search_path 固定
select test.check('chg_shape_helpers', (
  select string_agg(p.proname || ':definer=' || p.prosecdef::text || ':volatile=' || p.provolatile
                    || ':' || coalesce(array_to_string(p.proconfig, ';'), '-'), ',' order by p.proname)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('app_is_github_connector', 'app_can_see_github_repo')
), 'app_can_see_github_repo:definer=true:volatile=s:search_path=public,'
   'app_is_github_connector:definer=true:volatile=s:search_path=public');

-- 補助関数の実行権限: authenticated・service_role は可、anon は不可
select test.check('chg_shape_helpers_execute', (
  select string_agg(p.proname
                    || ':authenticated=' || has_function_privilege('authenticated', p.oid, 'execute')::text
                    || ':service_role=' || has_function_privilege('service_role', p.oid, 'execute')::text
                    || ':anon=' || has_function_privilege('anon', p.oid, 'execute')::text, ',' order by p.proname)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('app_is_github_connector', 'app_can_see_github_repo')
), 'app_can_see_github_repo:authenticated=true:service_role=true:anon=false,'
   'app_is_github_connector:authenticated=true:service_role=true:anon=false');

-- 索引: space_github_repos(github_repo_id) の単独索引
select test.check('chg_shape_space_repos_repo_index', (
  select count(*) from pg_index i
  where i.indrelid = 'public.space_github_repos'::regclass
    and i.indnatts = 1
    and i.indkey[0] = (select a.attnum from pg_attribute a
                       where a.attrelid = 'public.space_github_repos'::regclass and a.attname = 'github_repo_id')
)::text, '1');

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
    raise exception 'GITHUB VISIBILITY CHECKS FAILED (% failures)', v_fail;
  end if;
end $$;
select 'GITHUB VISIBILITY CHECKS PASSED' as result;
