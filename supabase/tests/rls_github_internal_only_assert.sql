-- =============================================================================
-- GitHub 連携テーブル RLS（社内メンバー限定）の挙動検証
-- 前提: run_rls_github_internal_only.sh が baseline → 実 migration を verbatim 適用済み。
--
-- 視点（org O1 に S1=お客さんA / S2=お客さんB、別 org O2 に S3）:
--   int_own    社内 owner（S1・S2 の space admin）
--   int_mem    社内 member（S1 の space editor）
--   int_memout 社内 member（どの space にも入っていない）
--   int_o2     別 org O2 の社内 member（S3 の editor）… org をまたがないことの確認
--   ext_cli    client（org=client ＋ S1 space=client）
--   ext_ven    vendor（org=client ＋ S1 space=vendor：rpc_accept_invite の実マッピング）
--   ext_clied  org=client だが S1 の space role が editor
--   ext_cliadm org=client だが S1 の space role が admin
--   ext_clis2  別のお客さん（org=client ＋ S2 space=client）
--   ext_dual   O1 では client（S1 editor）だが、別 org O2 では社内 member
--
-- 出力: PASS[label] / FAIL[label]。最後に FAIL が 0 件なら
--   "RLS GITHUB INTERNAL ONLY CHECKS PASSED"。1件でもあれば例外で終了する。
-- 書き込み系は test.try がサブトランザクション内で実行し必ず巻き戻す（各 assert は独立）。
-- label は int_*（社内視点・修正前後で同じ結果であるべき）/ ext_*（社外視点）/ shape_*（ポリシー形状）。
-- =============================================================================
set client_min_messages = notice;

\set O1 '00000000-0000-0000-0000-0000000000a1'
\set O2 '00000000-0000-0000-0000-0000000000a2'
\set S1 '00000000-0000-0000-0000-0000000000b1'
\set S2 '00000000-0000-0000-0000-0000000000b2'
\set S3 '00000000-0000-0000-0000-0000000000b3'
\set u_own    '00000000-0000-0000-0000-0000000000c1'
\set u_mem    '00000000-0000-0000-0000-0000000000c2'
\set u_memout '00000000-0000-0000-0000-0000000000c3'
\set u_cli    '00000000-0000-0000-0000-0000000000c4'
\set u_ven    '00000000-0000-0000-0000-0000000000c5'
\set u_clied  '00000000-0000-0000-0000-0000000000c6'
\set u_cliadm '00000000-0000-0000-0000-0000000000c7'
\set u_clis2  '00000000-0000-0000-0000-0000000000c8'
\set u_o2     '00000000-0000-0000-0000-0000000000c9'
\set u_dual   '00000000-0000-0000-0000-0000000000ca'
\set T1  '00000000-0000-0000-0000-0000000000d1'
\set T1b '00000000-0000-0000-0000-0000000000d2'
\set T2  '00000000-0000-0000-0000-0000000000d3'
\set T3  '00000000-0000-0000-0000-0000000000d4'
\set I1 '00000000-0000-0000-0000-000000000a01'
\set I2 '00000000-0000-0000-0000-000000000a02'
\set R1 '00000000-0000-0000-0000-0000000000e1'
\set R2 '00000000-0000-0000-0000-0000000000e2'
\set R3 '00000000-0000-0000-0000-0000000000e3'
\set SG1 '00000000-0000-0000-0000-000000000b01'
\set SG2 '00000000-0000-0000-0000-000000000b02'
\set SG3 '00000000-0000-0000-0000-000000000b03'
\set P1 '00000000-0000-0000-0000-0000000000f1'
\set P2 '00000000-0000-0000-0000-0000000000f2'
\set P3 '00000000-0000-0000-0000-0000000000f3'
\set K1 '00000000-0000-0000-0000-000000000c01'
\set K2 '00000000-0000-0000-0000-000000000c02'
\set K3 '00000000-0000-0000-0000-000000000c03'
\set K4 '00000000-0000-0000-0000-000000000c04'

-- -----------------------------------------------------------------------------
-- 検証ヘルパ
-- -----------------------------------------------------------------------------
create schema if not exists test;
grant usage on schema test to authenticated;
create table test.results (seq serial primary key, label text, ok boolean, got text, want text);

-- 結果の記録（definer: authenticated 視点のままでも記録できる）
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

create or replace function test.ins_link(p_org uuid, p_task uuid, p_pr uuid, p_by uuid)
returns text language sql as $$
  select test.try(format(
    'insert into public.task_github_links(org_id, task_id, github_pr_id, link_type, created_by) values (%L, %L, %L, %L, %L)',
    p_org, p_task, p_pr, 'manual', p_by));
$$;

-- アプリの POST /api/github/spaces と同じく insert 後に行を読み返す（returning）
create or replace function test.ins_space_repo(p_org uuid, p_space uuid, p_repo uuid, p_by uuid)
returns text language sql as $$
  select test.try(format(
    'insert into public.space_github_repos(org_id, space_id, github_repo_id, created_by) values (%L, %L, %L, %L) returning id',
    p_org, p_space, p_repo, p_by));
$$;

create or replace function test.del(p_table text, p_id uuid)
returns text language sql as $$
  select test.try(format('delete from public.%I where id = %L', p_table, p_id));
$$;

create or replace function test.upd(p_table text, p_set text, p_id uuid)
returns text language sql as $$
  select test.try(format('update public.%I set %s where id = %L', p_table, p_set, p_id));
$$;

-- 5表の見える行数を呼び出し元の視点で数えて記録する
create or replace function test.check_counts(p_who text, p_inst int, p_repo int, p_sgr int, p_pr int, p_link int)
returns void language plpgsql security invoker as $$
begin
  perform test.check(p_who || '_installations', (select count(*) from public.github_installations)::text, p_inst::text);
  perform test.check(p_who || '_repositories',  (select count(*) from public.github_repositories)::text,  p_repo::text);
  perform test.check(p_who || '_space_repos',   (select count(*) from public.space_github_repos)::text,   p_sgr::text);
  perform test.check(p_who || '_pull_requests', (select count(*) from public.github_pull_requests)::text, p_pr::text);
  perform test.check(p_who || '_task_links',    (select count(*) from public.task_github_links)::text,    p_link::text);
end $$;

-- -----------------------------------------------------------------------------
-- データ（postgres で投入。RLS は通らない）
-- -----------------------------------------------------------------------------
insert into public.organizations(id) values (:'O1'), (:'O2');
insert into public.spaces(id, org_id, name) values
  (:'S1', :'O1', 'customer-a'),
  (:'S2', :'O1', 'customer-b'),
  (:'S3', :'O2', 'o2-space');
insert into auth.users(id) values
  (:'u_own'), (:'u_mem'), (:'u_memout'), (:'u_cli'), (:'u_ven'),
  (:'u_clied'), (:'u_cliadm'), (:'u_clis2'), (:'u_o2'), (:'u_dual');

insert into public.org_memberships(org_id, user_id, role) values
  (:'O1', :'u_own',    'owner'),
  (:'O1', :'u_mem',    'member'),
  (:'O1', :'u_memout', 'member'),
  (:'O1', :'u_cli',    'client'),
  (:'O1', :'u_ven',    'client'),   -- vendor 招待の受諾結果は org=client（20260706004313）
  (:'O1', :'u_clied',  'client'),
  (:'O1', :'u_cliadm', 'client'),
  (:'O1', :'u_clis2',  'client'),
  (:'O1', :'u_dual',   'client'),
  (:'O2', :'u_o2',     'member'),
  (:'O2', :'u_dual',   'member');
insert into public.space_memberships(space_id, user_id, role) values
  (:'S1', :'u_own',    'admin'),
  (:'S2', :'u_own',    'admin'),
  (:'S1', :'u_mem',    'editor'),
  (:'S1', :'u_cli',    'client'),
  (:'S1', :'u_ven',    'vendor'),   -- vendor 招待の受諾結果は space=vendor
  (:'S1', :'u_clied',  'editor'),
  (:'S1', :'u_cliadm', 'admin'),
  (:'S2', :'u_clis2',  'client'),
  (:'S3', :'u_o2',     'editor'),
  (:'S1', :'u_dual',   'editor');

-- タスクは全て deliverable（お客さんにも見えるタスク）＝社外視点で最も見えやすい条件で試す
insert into public.tasks(id, org_id, space_id, title, ball, client_scope) values
  (:'T1',  :'O1', :'S1', 't1',  'internal', 'deliverable'),
  (:'T1b', :'O1', :'S1', 't1b', 'internal', 'deliverable'),
  (:'T2',  :'O1', :'S2', 't2',  'internal', 'deliverable'),
  (:'T3',  :'O2', :'S3', 't3',  'internal', 'deliverable');

insert into public.github_installations(id, org_id, installation_id, account_login, created_by) values
  (:'I1', :'O1', 101, 'o1-gh', :'u_own'),
  (:'I2', :'O2', 202, 'o2-gh', :'u_o2');
insert into public.github_repositories(id, org_id, installation_id, repo_id, owner_login, repo_name) values
  (:'R1', :'O1', 101, 1001, 'o1-gh', 'repo-a'),
  (:'R2', :'O1', 101, 1002, 'o1-gh', 'repo-b'),
  (:'R3', :'O2', 202, 2001, 'o2-gh', 'repo-c');
insert into public.space_github_repos(id, org_id, space_id, github_repo_id, created_by) values
  (:'SG1', :'O1', :'S1', :'R1', :'u_own'),
  (:'SG2', :'O1', :'S2', :'R2', :'u_own'),
  (:'SG3', :'O2', :'S3', :'R3', :'u_o2');
insert into public.github_pull_requests(id, org_id, github_repo_id, pr_number, pr_title, pr_url, pr_state, pr_created_at) values
  (:'P1', :'O1', :'R1', 1, 'pr-1', 'https://example.invalid/1', 'open', now()),
  (:'P2', :'O1', :'R2', 2, 'pr-2', 'https://example.invalid/2', 'open', now()),
  (:'P3', :'O2', :'R3', 3, 'pr-3', 'https://example.invalid/3', 'open', now());
-- K2 は「修正前に作られていた、org=client 利用者が作成者の紐づけ」を再現
insert into public.task_github_links(id, org_id, task_id, github_pr_id, link_type, created_by) values
  (:'K1', :'O1', :'T1',  :'P1', 'manual', :'u_mem'),
  (:'K2', :'O1', :'T1b', :'P1', 'manual', :'u_clied'),
  (:'K3', :'O1', :'T2',  :'P2', 'manual', :'u_own'),
  (:'K4', :'O2', :'T3',  :'P3', 'manual', :'u_o2');
insert into public.github_webhook_events(org_id, installation_id, event_type, payload) values
  (:'O1', 101, 'pull_request', '{}'::jsonb),
  (:'O2', 202, 'pull_request', '{}'::jsonb);

-- -----------------------------------------------------------------------------
-- 読み取り: 視点ごとの見える行数（installations / repositories / space_repos / pull_requests / task_links）
-- -----------------------------------------------------------------------------
set role authenticated;

\echo '== read: internal viewpoints =='
select set_config('test.uid', :'u_own', false);
select test.check_counts('int_own', 1, 2, 2, 2, 3);
select test.check('int_own_webhook_events', (select count(*) from public.github_webhook_events)::text, '1');

select set_config('test.uid', :'u_mem', false);
select test.check_counts('int_mem', 1, 2, 1, 2, 2);
select test.check('int_mem_space_repos_not_s2', (select count(*) from public.space_github_repos where space_id = :'S2')::text, '0');
select test.check('int_mem_task_links_not_s2', (select count(*) from public.task_github_links where task_id = :'T2')::text, '0');
select test.check('int_mem_webhook_events', (select count(*) from public.github_webhook_events)::text, '0');

select set_config('test.uid', :'u_memout', false);
select test.check_counts('int_memout', 1, 2, 0, 2, 0);

select set_config('test.uid', :'u_o2', false);
select test.check_counts('int_o2', 1, 1, 1, 1, 1);

\echo '== read: external viewpoints (all must be 0) =='
select set_config('test.uid', :'u_cli', false);
select test.check_counts('ext_cli', 0, 0, 0, 0, 0);
select test.check('ext_cli_webhook_events', (select count(*) from public.github_webhook_events)::text, '0');

select set_config('test.uid', :'u_ven', false);
select test.check_counts('ext_ven', 0, 0, 0, 0, 0);

select set_config('test.uid', :'u_clied', false);
select test.check_counts('ext_clied', 0, 0, 0, 0, 0);

select set_config('test.uid', :'u_cliadm', false);
select test.check_counts('ext_cliadm', 0, 0, 0, 0, 0);

select set_config('test.uid', :'u_clis2', false);
select test.check_counts('ext_clis2', 0, 0, 0, 0, 0);

-- dual は O2 の社内 member なので O2 の installation/repository/PR は見える（S3 のメンバーではない）。
-- O1 側（client としての所属先）の行は5表とも 0 であること。
select set_config('test.uid', :'u_dual', false);
select test.check_counts('ext_dual', 1, 1, 0, 1, 0);
select test.check('ext_dual_o1_rows',
  ((select count(*) from public.github_installations where org_id = :'O1')
 + (select count(*) from public.github_repositories  where org_id = :'O1')
 + (select count(*) from public.space_github_repos   where org_id = :'O1')
 + (select count(*) from public.github_pull_requests where org_id = :'O1')
 + (select count(*) from public.task_github_links    where org_id = :'O1'))::text, '0');

-- -----------------------------------------------------------------------------
-- 書き込み: task_github_links（insert = 社内 かつ space admin/editor / delete = (作成者 or space admin) かつ 社内 / update なし）
-- -----------------------------------------------------------------------------
\echo '== write: task_github_links =='
select set_config('test.uid', :'u_mem', false);
select test.check('int_mem_insert_link',             test.ins_link(:'O1', :'T1', :'P2', :'u_mem'), 'ok:1');
select test.check('int_mem_insert_link_other_space', test.ins_link(:'O1', :'T2', :'P1', :'u_mem'), 'denied');
select test.check('int_mem_delete_own_link',         test.del('task_github_links', :'K1'), 'ok:1');
select test.check('int_mem_delete_others_link',      test.del('task_github_links', :'K2'), 'ok:0');
select test.check('int_mem_update_link',             test.upd('task_github_links', 'link_type = ''auto''', :'K1'), 'ok:0');

select set_config('test.uid', :'u_memout', false);
select test.check('int_memout_insert_link', test.ins_link(:'O1', :'T1', :'P2', :'u_memout'), 'denied');

select set_config('test.uid', :'u_own', false);
select test.check('int_own_delete_link_as_space_admin', test.del('task_github_links', :'K2'), 'ok:1');
select test.check('int_own_update_link',                test.upd('task_github_links', 'link_type = ''auto''', :'K1'), 'ok:0');

select set_config('test.uid', :'u_cli', false);
select test.check('ext_cli_insert_link', test.ins_link(:'O1', :'T1', :'P2', :'u_cli'), 'denied');

select set_config('test.uid', :'u_ven', false);
select test.check('ext_ven_insert_link', test.ins_link(:'O1', :'T1', :'P2', :'u_ven'), 'denied');

select set_config('test.uid', :'u_clied', false);
select test.check('ext_clied_insert_link',     test.ins_link(:'O1', :'T1', :'P2', :'u_clied'), 'denied');
select test.check('ext_clied_delete_own_link', test.del('task_github_links', :'K2'), 'ok:0');

select set_config('test.uid', :'u_cliadm', false);
select test.check('ext_cliadm_insert_link', test.ins_link(:'O1', :'T1', :'P2', :'u_cliadm'), 'denied');
select test.check('ext_cliadm_delete_link', test.del('task_github_links', :'K1'), 'ok:0');

-- 行の org_id を「自分が社内の別 org」にすり替えても O1 のタスク/PR には紐づけられないこと
select set_config('test.uid', :'u_dual', false);
select test.check('ext_dual_insert_link_other_org_id', test.ins_link(:'O2', :'T1', :'P2', :'u_dual'), 'denied');

-- -----------------------------------------------------------------------------
-- 書き込み: space_github_repos（for all = space admin/editor かつ 社内）
-- -----------------------------------------------------------------------------
\echo '== write: space_github_repos =='
select set_config('test.uid', :'u_mem', false);
select test.check('int_mem_insert_space_repo', test.ins_space_repo(:'O1', :'S1', :'R2', :'u_mem'), 'ok:1');
select test.check('int_mem_update_space_repo', test.upd('space_github_repos', 'sync_prs = false', :'SG1'), 'ok:1');
select test.check('int_mem_delete_space_repo', test.del('space_github_repos', :'SG1'), 'ok:1');

select set_config('test.uid', :'u_memout', false);
select test.check('int_memout_insert_space_repo', test.ins_space_repo(:'O1', :'S1', :'R2', :'u_memout'), 'denied');

select set_config('test.uid', :'u_ven', false);
select test.check('ext_ven_insert_space_repo', test.ins_space_repo(:'O1', :'S1', :'R2', :'u_ven'), 'denied');

select set_config('test.uid', :'u_clied', false);
select test.check('ext_clied_insert_space_repo', test.ins_space_repo(:'O1', :'S1', :'R2', :'u_clied'), 'denied');
select test.check('ext_clied_update_space_repo', test.upd('space_github_repos', 'sync_prs = false', :'SG1'), 'ok:0');

select set_config('test.uid', :'u_cliadm', false);
select test.check('ext_cliadm_insert_space_repo', test.ins_space_repo(:'O1', :'S1', :'R2', :'u_cliadm'), 'denied');
select test.check('ext_cliadm_delete_space_repo', test.del('space_github_repos', :'SG1'), 'ok:0');

select set_config('test.uid', :'u_dual', false);
select test.check('ext_dual_insert_space_repo_other_org_id', test.ins_space_repo(:'O2', :'S1', :'R2', :'u_dual'), 'denied');

-- -----------------------------------------------------------------------------
-- 書き込み: 変更しない表（installations / repositories は owner のみ・PR は書込ポリシーなし）
-- -----------------------------------------------------------------------------
\echo '== write: unchanged owner-only / no-write tables =='
select set_config('test.uid', :'u_own', false);
select test.check('int_own_update_installation', test.upd('github_installations', 'account_login = ''o1-gh2''', :'I1'), 'ok:1');
select test.check('int_own_update_repository',   test.upd('github_repositories', 'default_branch = ''dev''', :'R1'), 'ok:1');
select test.check('int_own_update_pr',           test.upd('github_pull_requests', 'pr_title = ''x''', :'P1'), 'ok:0');
select test.check('int_own_insert_pr', test.try(format(
  'insert into public.github_pull_requests(org_id, github_repo_id, pr_number, pr_title, pr_url, pr_state, pr_created_at) values (%L, %L, 9, %L, %L, %L, now())',
  :'O1', :'R1', 'pr-9', 'https://example.invalid/9', 'open')), 'denied:42501');

select set_config('test.uid', :'u_mem', false);
select test.check('int_mem_update_installation', test.upd('github_installations', 'account_login = ''x''', :'I1'), 'ok:0');
select test.check('int_mem_update_repository',   test.upd('github_repositories', 'default_branch = ''x''', :'R1'), 'ok:0');

select set_config('test.uid', :'u_cli', false);
select test.check('ext_cli_update_repository', test.upd('github_repositories', 'default_branch = ''x''', :'R1'), 'ok:0');

-- -----------------------------------------------------------------------------
-- ポリシー単体の確認: 既存トリガー（組織一致チェック）を止めても RLS 自体が拒否すること
--   トリガーは呼び出し元の権限で github_* を読むため、上の denied は P0001（トリガー）で
--   返ることがある。ここでは session_replication_role=replica でトリガーを止め、RLS の判定だけを見る。
-- -----------------------------------------------------------------------------
\echo '== policy only (triggers disabled) =='
reset role;
set session_replication_role = replica;
set role authenticated;

select set_config('test.uid', :'u_mem', false);
select test.check('int_nt_mem_insert_link',       test.ins_link(:'O1', :'T1', :'P2', :'u_mem'), 'ok:1');
select test.check('int_nt_mem_insert_space_repo', test.ins_space_repo(:'O1', :'S1', :'R2', :'u_mem'), 'ok:1');

select set_config('test.uid', :'u_clied', false);
select test.check('ext_nt_clied_insert_link',       test.ins_link(:'O1', :'T1', :'P2', :'u_clied'), 'denied:42501');
select test.check('ext_nt_clied_insert_space_repo', test.ins_space_repo(:'O1', :'S1', :'R2', :'u_clied'), 'denied:42501');

select set_config('test.uid', :'u_cliadm', false);
select test.check('ext_nt_cliadm_insert_link',       test.ins_link(:'O1', :'T1', :'P2', :'u_cliadm'), 'denied:42501');
select test.check('ext_nt_cliadm_insert_space_repo', test.ins_space_repo(:'O1', :'S1', :'R2', :'u_cliadm'), 'denied:42501');

reset role;
set session_replication_role = origin;

-- -----------------------------------------------------------------------------
-- ポリシー形状: 5表の permissive ポリシーは全て「社内判定」か「owner 限定」を含むこと
--   （社内判定の無い広いポリシーが残っていない／将来足されていないことの確認）
-- -----------------------------------------------------------------------------
\echo '== policy shape =='
select test.check('shape_permissive_policies_internal_or_owner', (
  select count(*) from pg_policies p
  where p.schemaname = 'public'
    and p.tablename in ('github_installations', 'github_repositories', 'space_github_repos',
                        'github_pull_requests', 'task_github_links')
    and p.permissive = 'PERMISSIVE'
    and coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') not like '%app_is_org_internal%'
    and coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') not like '%''owner''%'
)::text, '0');
select test.check('shape_webhook_events_unchanged', (
  select string_agg(policyname, ',' order by policyname) from pg_policies
  where schemaname = 'public' and tablename = 'github_webhook_events'
), 'org owners can view webhook events');

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
    raise exception 'RLS GITHUB INTERNAL ONLY CHECKS FAILED (% failures)', v_fail;
  end if;
end $$;
select 'RLS GITHUB INTERNAL ONLY CHECKS PASSED' as result;
