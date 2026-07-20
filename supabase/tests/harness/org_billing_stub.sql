-- =============================================================================
-- org_push_quota 検証ハーネス: org_billing 最小スタブ + backfill 検証用の既存行
-- 本番では 20240103_000_auth_billing.sql が org_billing / plans を作るが、その migration は
-- invites 等の別テーブルにも依存するため、ここでは app_org_push_quota / トリガー / backfill が
-- 使う列だけを最小スタブする（baseline_stubs.sql が organizations をスタブするのと同じ規律）。
-- これは MY migration より前に適用し、適用時 backfill が既存行を拾うことを検証できるようにする。
-- =============================================================================
set client_min_messages = warning;

create table if not exists public.org_billing (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  plan_id text,
  status text not null default 'active',
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now()
);

-- backfill 検証用の「migration 適用前から存在する」org（トリガーはまだ無いので policy は未同期）。
insert into public.organizations values ('00000000-0000-0000-0000-0000000000b1'); -- 既存free
insert into public.organizations values ('00000000-0000-0000-0000-0000000000b2'); -- 既存pro active
insert into public.org_billing(org_id, plan_id, status) values
  ('00000000-0000-0000-0000-0000000000b1', 'free', 'active');
insert into public.org_billing(org_id, plan_id, status, current_period_end) values
  ('00000000-0000-0000-0000-0000000000b2', 'pro', 'active', now() + interval '30 days');
