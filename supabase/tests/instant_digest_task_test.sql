-- rpc_create_instant_digest_task（Stage 2.7-B §4-5）の下地。使い捨てスクラッチ。
-- グループ行ロック経由でメンション即時候補を作る RPC を、実 migration に忠実な最小スキーマで検証する。

set client_min_messages = warning;
create extension if not exists pgcrypto;

do $$ begin create role service_role;  exception when duplicate_object then null; end $$;
do $$ begin create role anon;          exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;

create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid());

create table public.organizations (id uuid primary key);
create table public.spaces (id uuid primary key, org_id uuid not null references public.organizations(id));

create table public.channel_groups (
  id uuid primary key,
  org_id uuid not null references public.organizations(id),
  space_id uuid null references public.spaces(id),
  approver_user_id uuid null references auth.users(id)
);

-- source_message_id と unique(source_message_id, title) を持たせる（webhook再送の冪等化を検証するため）
create table public.channel_digest_tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  group_id uuid not null references public.channel_groups(id),
  space_id uuid null,
  source_message_id uuid null,
  title text not null,
  assignee_hint text null,
  assignee_external_user_id text null,
  assignee_identity_id uuid null,
  due_date date null,
  due_time time null,
  extracted_date date null,
  promotion_state text not null default 'none',
  requested_to_user_id uuid null,
  requested_at timestamptz null,
  approval_notified_at timestamptz null,
  created_at timestamptz not null default now(),
  constraint channel_digest_tasks_source_title_uq unique (source_message_id, title)
);

-- 固定ID
--   org  o1 / space sp1 / approver ap1
--   group g_pending  = approver設定＋space紐付け（pending化する）
--   group g_noapp    = approver未設定（none）
--   group g_nospace  = approver設定だがspace未紐付け（none）
insert into auth.users (id) values
  ('a1111111-1111-4111-8111-111111111111');
insert into public.organizations (id) values ('01111111-1111-4111-8111-111111111111');
insert into public.spaces (id, org_id) values
  ('50000000-0000-4000-8000-000000000001', '01111111-1111-4111-8111-111111111111');

insert into public.channel_groups (id, org_id, space_id, approver_user_id) values
  ('11111111-1111-4111-8111-111111111111', '01111111-1111-4111-8111-111111111111',
   '50000000-0000-4000-8000-000000000001', 'a1111111-1111-4111-8111-111111111111'),  -- g_pending
  ('22222222-2222-4222-8222-222222222222', '01111111-1111-4111-8111-111111111111',
   '50000000-0000-4000-8000-000000000001', null),                                     -- g_noapp
  ('33333333-3333-4333-8333-333333333333', '01111111-1111-4111-8111-111111111111',
   null, 'a1111111-1111-4111-8111-111111111111');                                     -- g_nospace
