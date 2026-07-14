-- 責任者確認によるタスク昇格（Stage 2.7-B）の下地。スクラッチDB・使い捨て。
-- 最小の依存スキーマ + フィクスチャを作る。アサーションは promote_digest_task_assert.sql 側。
-- 間に本物の migration を挟むことで、テストが実装を先取りしないようにする。

set client_min_messages = warning;
create extension if not exists pgcrypto;

-- Supabase 由来のロール（本番には存在）。migration 末尾の GRANT/REVOKE を最後まで検証するためのスタブ。
do $$ begin create role anon;          exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role;  exception when duplicate_object then null; end $$;

create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid());

-- 依存テーブル（本番の必須列だけを最小再現）
create table public.organizations (id uuid primary key, name text default 'org');

create table public.spaces (
  id uuid primary key,
  org_id uuid not null references public.organizations(id)
);

create table public.org_memberships (
  org_id uuid not null,
  user_id uuid not null references auth.users(id),
  role text not null
);

create table public.space_memberships (
  space_id uuid not null,
  user_id uuid not null references auth.users(id),
  role text not null
);

create table public.channel_accounts (
  id uuid primary key,
  org_id uuid not null references public.organizations(id)
);

create table public.channel_groups (
  id uuid primary key,
  org_id uuid not null references public.organizations(id),
  account_id uuid not null references public.channel_accounts(id),
  space_id uuid null references public.spaces(id),
  approver_user_id uuid null references auth.users(id)
);

-- channel_user_links（PR1相当の最小形。承認のアクター解決に使う）
create table public.channel_user_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  user_id uuid not null references auth.users(id),
  channel_account_id uuid not null references public.channel_accounts(id),
  external_user_id text not null,
  revoked_at timestamptz null
);

-- tasks（本番の必須列 + client_scope）
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  space_id uuid not null,
  title text not null,
  description text not null default '',
  status text not null,
  ball text not null default 'internal',
  origin text not null default 'internal',
  type text not null default 'task',
  client_scope text not null default 'deliverable',
  due_date date null,
  assignee_id uuid null,
  created_by uuid not null,
  created_at timestamptz not null default now()
);

create table public.channel_digest_tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  group_id uuid not null references public.channel_groups(id),
  space_id uuid null,
  source_message_id uuid not null default gen_random_uuid(),
  title text not null,
  assignee_hint text null,
  status text not null default 'open',
  extracted_date date not null default current_date,
  due_date date null,
  created_at timestamptz not null default now()
);

-- フィクスチャ（固定ID）
insert into public.organizations(id) values
  ('00000000-0000-4000-8000-000000000001'),   -- org A（本命テナント）
  ('00000000-0000-4000-8000-000000000002');   -- org B（テナント越えテスト用）
insert into auth.users(id) values
  ('00000000-0000-4000-8000-0000000000a1'),  -- approver（責任者）
  ('00000000-0000-4000-8000-0000000000a2');  -- other（内部だが依頼先ではない）
insert into public.spaces(id, org_id) values
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-000000000002');  -- org B の space
insert into public.channel_accounts(id, org_id) values
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-000000000002');  -- org B のOA
insert into public.channel_groups(id, org_id, account_id, space_id, approver_user_id) values
  ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000b1',
   '00000000-0000-4000-8000-0000000000a1'),
  -- space未紐付けグループ（昇格先が無い）
  ('00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-0000000000c1', null,
   '00000000-0000-4000-8000-0000000000a1'),
  -- org B のグループ。approver は同一人物 a1（テナント越え攻撃の前提: a1 は org B でも責任者）
  ('00000000-0000-4000-8000-0000000000d3', '00000000-0000-4000-8000-000000000002',
   '00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000b2',
   '00000000-0000-4000-8000-0000000000a1');

-- approver は org内部 + space admin + LINE紐付け済み。
-- さらに a1 は org B のメンバー＋space editor でもある（＝内部認可だけなら org B タスクも通ってしまう状況）。
insert into public.org_memberships(org_id, user_id, role) values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 'member'),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a2', 'member'),
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000a1', 'member');
insert into public.space_memberships(space_id, user_id, role) values
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a1', 'admin'),
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a2', 'admin'),
  ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000a1', 'editor');
-- a1 の LINE 紐付けは org A / account c1 のみ（org B には紐付いていない）
insert into public.channel_user_links(org_id, user_id, channel_account_id, external_user_id) values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1',
   '00000000-0000-4000-8000-0000000000c1', 'Uapprover');
