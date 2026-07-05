-- V3 ベンダー可視範囲 RLS の挙動検証（スクラッチDB・使い捨て）
-- 最小スキーマ + 既存ヘルパ(20260703_001相当) + 本番同型ポリシー + 本ステージ(010)を再現し、
-- 内部/クライアント/ベンダー の3視点で SELECT 結果を検証する。
set client_min_messages = warning;

-- auth.uid() スタブ（テスト用 GUC から現在ユーザーを解決）
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid;
$$;

-- 最小スキーマ
create table spaces (id uuid primary key, org_id uuid not null, name text);
create table org_memberships (org_id uuid, user_id uuid, role text);
create table space_memberships (space_id uuid, user_id uuid, role text);
create table tasks (
  id uuid primary key, space_id uuid not null, org_id uuid not null,
  title text, status text, ball text, client_scope text
);

-- 既存ヘルパ(20260703_001 相当)
create or replace function public.app_is_org_internal(p_org uuid) returns boolean
  language sql stable security definer set search_path=public as $$
  select exists (select 1 from org_memberships m
    where m.org_id=p_org and m.user_id=auth.uid() and m.role in ('owner','admin','member'));
$$;
create or replace function public.app_is_space_member(p_space uuid) returns boolean
  language sql stable security definer set search_path=public as $$
  select exists (select 1 from space_memberships s
    where s.space_id=p_space and s.user_id=auth.uid());
$$;
-- 内部=org内全スペース可、client/vendor=自スペースのみ可
create or replace function public.app_can_access_space(p_space uuid, p_org uuid) returns boolean
  language sql stable security definer set search_path=public as $$
  select public.app_is_org_internal(p_org) or public.app_is_space_member(p_space);
$$;

-- ▼ 本ステージ(20260703_010) のヘルパ＋ポリシー ▼
create or replace function public.app_is_space_vendor(p_space uuid) returns boolean
  language sql stable security definer set search_path=public as $$
  select exists (select 1 from space_memberships s
    where s.space_id=p_space and s.user_id=auth.uid() and s.role='vendor');
$$;
create or replace function public.app_task_visible_to_caller(p_space uuid, p_org uuid, p_client_scope text, p_ball text)
  returns boolean language sql stable security definer set search_path=public as $$
  select public.app_can_access_space(p_space, p_org)
    and (
      public.app_is_org_internal(p_org)
      or ( p_client_scope='deliverable'
           and ( not public.app_is_space_vendor(p_space) or p_ball is distinct from 'client' ) )
    );
$$;

alter table tasks enable row level security;
alter table tasks force row level security;  -- owner(postgres)でも検証時に適用させる
create policy tasks_select_member on tasks for select to authenticated
  using ( public.app_task_visible_to_caller(space_id, org_id, client_scope, ball) );

-- ▼ Group 2 (20260703_011): task_pricing = 内部メンバー限定 ▼
create table task_pricing (
  id uuid primary key, org_id uuid not null, space_id uuid not null, task_id uuid not null,
  margin_rate numeric, sell_total numeric, cost_hours numeric
);
alter table task_pricing enable row level security;
alter table task_pricing force row level security;
create policy task_pricing_select_member on task_pricing for select to authenticated
  using ( public.app_is_org_internal(org_id) );

-- authenticated ロール（本番同名）を用意し、テーブルへ権限付与
do $$ begin if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if; end $$;
grant usage on schema public, auth to authenticated;
grant select on all tables in schema public to authenticated;
grant execute on all functions in schema public, auth to authenticated;

-- テストデータ
--   org O1 / space S1。内部ユーザ U_INT、クライアント U_CLI、ベンダー U_VEN。
insert into spaces values ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000a1','S1');
insert into org_memberships values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000c1','member');
insert into org_memberships values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000c2','client');
insert into space_memberships values ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000c2','client');
insert into space_memberships values ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000c3','vendor');
-- タスク4種
insert into tasks values ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000a1','deliverable/internal-ball','doing','internal','deliverable');
insert into tasks values ('00000000-0000-0000-0000-0000000000d2','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000a1','deliverable/client-ball','doing','client','deliverable');
insert into tasks values ('00000000-0000-0000-0000-0000000000d3','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000a1','internal-scope','doing','internal','internal');
insert into tasks values ('00000000-0000-0000-0000-0000000000d4','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000a1','null-scope','doing','internal',null);
-- deliverable/非client-ball の tsk1 に pricing（もうけ額）を紐付け
insert into task_pricing values ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000d1',30.0,500000,10);

-- 検証ヘルパ: 期待件数をアサート
create or replace function assert_count(label text, got int, want int) returns void language plpgsql as $$
begin
  if got <> want then raise exception 'FAIL[%]: got %, want %', label, got, want;
  else raise notice 'PASS[%]: %', label, got; end if;
end $$;

set role authenticated;

-- 内部メンバー: タスク全4件 + pricing 1件（もうけ額が見える）
set test.uid = '00000000-0000-0000-0000-0000000000c1';
select assert_count('internal_sees_all', (select count(*) from tasks)::int, 4);
select assert_count('internal_sees_pricing', (select count(*) from task_pricing)::int, 1);

-- クライアント: deliverable の2件（internal-ball も client-ball も可）、internal/null は不可。pricingは0件
set test.uid = '00000000-0000-0000-0000-0000000000c2';
select assert_count('client_sees_deliverable_only', (select count(*) from tasks)::int, 2);
select assert_count('client_sees_client_ball', (select count(*) from tasks where ball='client')::int, 1);
select assert_count('client_hides_pricing', (select count(*) from task_pricing)::int, 0);

-- ベンダー: deliverable かつ 非client-ball の1件のみ。pricing(もうけ額)は0件
set test.uid = '00000000-0000-0000-0000-0000000000c3';
select assert_count('vendor_sees_deliverable_nonclientball', (select count(*) from tasks)::int, 1);
select assert_count('vendor_hides_client_ball', (select count(*) from tasks where ball='client')::int, 0);
select assert_count('vendor_hides_internal_scope', (select count(*) from tasks where client_scope='internal')::int, 0);
select assert_count('vendor_hides_pricing_margin', (select count(*) from task_pricing)::int, 0);

reset role;
select 'ALL CHECKS PASSED' as result;
