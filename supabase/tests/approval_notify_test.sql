-- rpc_claim_pending_approval_notifications（Stage 2.7-B §4-4）の下地。使い捨てスクラッチ。
-- approval_notified_at 列は本物の migration が追加するので、ここでは *作らない*。

set client_min_messages = warning;
create extension if not exists pgcrypto;

do $$ begin create role service_role;  exception when duplicate_object then null; end $$;
do $$ begin create role anon;          exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;

create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid());

create table public.organizations (id uuid primary key);
create table public.spaces (id uuid primary key, org_id uuid not null references public.organizations(id));
create table public.channel_accounts (id uuid primary key, org_id uuid not null references public.organizations(id));

create table public.channel_groups (
  id uuid primary key,
  org_id uuid not null references public.organizations(id),
  account_id uuid not null references public.channel_accounts(id),
  space_id uuid null references public.spaces(id),
  display_name text null,
  approver_user_id uuid null references auth.users(id)
);

create table public.channel_user_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  user_id uuid not null references auth.users(id),
  channel_account_id uuid not null references public.channel_accounts(id),
  external_user_id text not null,
  linked_at timestamptz not null default now(),
  revoked_at timestamptz null
);

create table public.channel_digest_tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  group_id uuid not null references public.channel_groups(id),
  title text not null,
  due_date date null,
  due_time time null,
  assignee_hint text null,
  promotion_state text not null default 'none',
  requested_to_user_id uuid null,
  requested_at timestamptz null,
  created_at timestamptz not null default now()
  -- approval_notified_at は migration が追加する
);

-- 認可述語 _digest_actor_can_approve が参照する在籍テーブル。
-- claim は「有効リンク」だけでなく「*現在も* 承認権限を持つ」ことを要求する（退職者漏洩防止）。
create table public.org_memberships (org_id uuid, user_id uuid, role text);
create table public.space_memberships (space_id uuid, user_id uuid, role text);

-- 本物の migration 20260715074403 の定義を忠実に再現（スクラッチは単一migrationしか読まないため）。
-- 実体の予測どおりに claim が在籍/責任者一致/space権限を要求することを検証する。
create or replace function public._digest_actor_can_approve(
  p_task public.channel_digest_tasks,
  p_actor_user_id uuid
) returns boolean language sql stable as $$
  select
    p_task.requested_to_user_id = p_actor_user_id
    and exists (
      select 1 from channel_groups g
      where g.id = p_task.group_id and g.approver_user_id = p_actor_user_id
    )
    and exists (
      select 1 from org_memberships m
      where m.org_id = p_task.org_id and m.user_id = p_actor_user_id
        and m.role in ('owner', 'admin', 'member')
    )
    and exists (
      select 1 from channel_groups g
      join space_memberships s on s.space_id = g.space_id
      where g.id = p_task.group_id
        and s.user_id = p_actor_user_id
        and s.role in ('admin', 'editor')
    );
$$;

-- フィクスチャ
insert into public.organizations(id) values ('00000000-0000-4000-8000-000000000001');
insert into auth.users(id) values
  ('00000000-0000-4000-8000-0000000000a1'),  -- approver（紐付けあり・在籍あり）
  ('00000000-0000-4000-8000-0000000000a2'),  -- approver（当初リンク無し・在籍あり）
  ('00000000-0000-4000-8000-0000000000a3');  -- 退職者approver（リンクありだが在籍なし＝漏洩ガード）
insert into public.spaces(id, org_id) values
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-000000000001');
insert into public.channel_accounts(id, org_id) values
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-000000000001');

-- g1: approver a1（紐付けあり）/ g2: approver a2（紐付け無し）
insert into public.channel_groups(id, org_id, account_id, space_id, approver_user_id) values
  ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000b1',
   '00000000-0000-4000-8000-0000000000a1'),
  ('00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000b1',
   '00000000-0000-4000-8000-0000000000a2');

-- a1 の 1:1 紐付け（有効）。念のため2件（同一account・別external）入れて、claim が1行に確定するか見る
insert into public.channel_user_links(org_id, user_id, channel_account_id, external_user_id, linked_at) values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1',
   '00000000-0000-4000-8000-0000000000c1', 'Uapprover-old', now() - interval '2 day'),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1',
   '00000000-0000-4000-8000-0000000000c1', 'Uapprover-new', now());

-- g3: 退職者 approver a3（有効リンクは残るが org/space 在籍が無い＝現在は承認権限なし）
insert into public.channel_groups(id, org_id, account_id, space_id, approver_user_id) values
  ('00000000-0000-4000-8000-0000000000d3', '00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000b1',
   '00000000-0000-4000-8000-0000000000a3');
insert into public.channel_user_links(org_id, user_id, channel_account_id, external_user_id) values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a3',
   '00000000-0000-4000-8000-0000000000c1', 'Uex-staff');

-- 在籍: a1・a2 は現在も org メンバー＋対象spaceの editor（claim 可）。a3 は在籍なし（claim 不可）
insert into public.org_memberships(org_id, user_id, role) values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 'member'),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a2', 'member');
insert into public.space_memberships(space_id, user_id, role) values
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a1', 'editor'),
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a2', 'editor');
