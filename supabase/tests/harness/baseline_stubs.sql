-- =============================================================================
-- 共有bot テナンシー検証ハーネス: baseline スタブ
-- 目的: 実 migration（20260715092422〜092426）を「1行も改変せず verbatim 適用」して
--   検証するための最小土台。手コピー禁止（設計正本 §3 検証ハーネスの規律）。
--
-- ここでは Supabase 固有の依存（auth / storage / roles）と、prior migration が前提とする
--   ベーススキーマ（organizations / spaces / *_memberships）だけを最小スタブする。
--   channel_* の DDL は一切書かない（それらは実 migration が作る）。
-- 使い捨てクラスタ専用。
-- =============================================================================
set client_min_messages = warning;

-- Supabase の3ロール（migration の revoke/grant が要求する）
do $$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if; end $$;

-- auth スキーマ + auth.uid() スタブ（本番は JWT 由来。テストは GUC test.uid で切替える）
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid;
$$;

-- storage スキーマ + buckets スタブ（channel_plumbing が insert する）
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text,
  public boolean,
  file_size_limit bigint
);

-- ベーススキーマ（本番の初期 schema migration 相当の最小形）
create table if not exists public.organizations (
  id uuid primary key
);
create table if not exists public.spaces (
  id uuid primary key,
  org_id uuid not null,
  name text
);
create table if not exists public.org_memberships (
  org_id uuid,
  user_id uuid,
  role text
);
create table if not exists public.space_memberships (
  space_id uuid,
  user_id uuid,
  role text
);
