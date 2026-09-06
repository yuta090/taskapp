-- =============================================================================
-- profiles.is_superadmin 権限昇格ガードの検証セットアップ（使い捨てスクラッチ専用）。
-- 目的: 実 migration（20260906082330_profiles_superadmin_guard.sql）を verbatim 適用して、
--   「ログイン済みの一般ユーザーが自分の is_superadmin を true にできない」ことを検証する。
-- 本番の profiles（列・RLS・GRANT）を最小限そのまま再現する。
--
-- 使い方:
--   psql -f supabase/tests/harness/profiles_superadmin_guard_setup.sql
--   psql -f supabase/migrations/20260906082330_profiles_superadmin_guard.sql   （← 無しで流すと RED）
--   psql -f supabase/tests/profiles_superadmin_guard_assert.sql
-- =============================================================================
set client_min_messages = warning;
create extension if not exists pgcrypto;

do $$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if; end $$;
grant usage on schema public to anon, authenticated, service_role;

-- auth スタブ（本番は JWT 由来。PostgREST と同じ request.jwt.claim.sub を読む）
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'authenticated');
$$;

-- 本番 profiles と同じ列・RLS・GRANT
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text default '',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_superadmin boolean not null default false,
  onboarding_flags jsonb not null default '{}'::jsonb,
  reminder_emails_enabled boolean not null default true,
  due_reminder_enabled boolean not null default true
);
alter table public.profiles enable row level security;
create policy "Profiles are viewable by authenticated users" on public.profiles for select using (auth.role() = 'authenticated');
create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);
create policy "Users can insert own profile" on public.profiles for insert with check (auth.uid() = id);
grant all on table public.profiles to anon, authenticated, service_role;

-- フィクスチャ: 運営 A / 一般 B / profile 未作成の C
insert into auth.users(id, email) values
  ('00000000-0000-4000-8000-0000000000aa', 'admin@example.com'),
  ('00000000-0000-4000-8000-0000000000bb', 'user@example.com'),
  ('00000000-0000-4000-8000-0000000000cc', 'noprofile@example.com');
insert into public.profiles(id, display_name, is_superadmin) values
  ('00000000-0000-4000-8000-0000000000aa', '運営A', true),
  ('00000000-0000-4000-8000-0000000000bb', '一般B', false);
