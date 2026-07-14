-- rpc_ingest_digest_tasks の pending 生成（Stage 2.7-B §4-2）の下地。使い捨てスクラッチ。
-- 最小の依存スキーマ + フィクスチャ。アサーションは ingest_pending_assert.sql 側。
-- 間に本物の migration（20260715083545_ingest_pending_promotion.sql）を挟む。

set client_min_messages = warning;
create extension if not exists pgcrypto;

do $$ begin create role service_role; exception when duplicate_object then null; end $$;
do $$ begin create role anon;         exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;

create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid());

create table public.organizations (id uuid primary key);
create table public.spaces (id uuid primary key, org_id uuid not null references public.organizations(id));

create table public.channel_groups (
  id uuid primary key,
  org_id uuid not null references public.organizations(id),
  space_id uuid null references public.spaces(id),
  approver_user_id uuid null references auth.users(id),
  last_extracted_message_created_at timestamptz null
);

-- 本番の channel_digest_tasks のうち ingest が触る列 + 状態機械列 + 排他CHECK を再現
create table public.channel_digest_tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  group_id uuid not null references public.channel_groups(id),
  space_id uuid null,
  source_message_id uuid not null,
  title text not null,
  assignee_hint text null,
  assignee_external_user_id text null,
  assignee_identity_id uuid null,
  due_date date null,
  due_time time null,
  extracted_date date not null default current_date,
  status text not null default 'open',
  promotion_state text not null default 'none'
    check (promotion_state in ('none','pending','promoted','rejected')),
  requested_to_user_id uuid null references auth.users(id),
  requested_at timestamptz null,
  promoted_task_id uuid null,
  confirmed_by_user_id uuid null,
  confirmed_at timestamptz null,
  rejected_by_user_id uuid null,
  rejected_at timestamptz null,
  created_at timestamptz not null default now(),
  unique (source_message_id, title),
  constraint digest_promotion_state_chk check (
    (promotion_state = 'none'
      and requested_to_user_id is null and requested_at is null
      and promoted_task_id is null
      and confirmed_by_user_id is null and confirmed_at is null
      and rejected_by_user_id is null and rejected_at is null)
    or (promotion_state = 'pending'
      and requested_to_user_id is not null and requested_at is not null
      and promoted_task_id is null
      and confirmed_by_user_id is null and confirmed_at is null
      and rejected_by_user_id is null and rejected_at is null)
    or (promotion_state = 'promoted'
      and requested_to_user_id is not null and requested_at is not null
      and confirmed_by_user_id is not null and confirmed_at is not null
      and rejected_by_user_id is null and rejected_at is null)
    or (promotion_state = 'rejected'
      and requested_to_user_id is not null and requested_at is not null
      and promoted_task_id is null
      and rejected_by_user_id is not null and rejected_at is not null
      and confirmed_by_user_id is null and confirmed_at is null)
  )
);

-- フィクスチャ
insert into public.organizations(id) values ('00000000-0000-4000-8000-000000000001');
insert into auth.users(id) values ('00000000-0000-4000-8000-0000000000a1'); -- approver
insert into public.spaces(id, org_id) values
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-000000000001');

-- g1: approver + space あり（→ pending）
-- g2: approver なし + space あり（→ none 従来動作）
-- g3: approver あり + space なし（→ none。昇格先が無い）
insert into public.channel_groups(id, org_id, space_id, approver_user_id) values
  ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a1'),
  ('00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-0000000000b1', null),
  ('00000000-0000-4000-8000-0000000000d3', '00000000-0000-4000-8000-000000000001',
   null, '00000000-0000-4000-8000-0000000000a1');
