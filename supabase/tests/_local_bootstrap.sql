-- ローカル・スクラッチDBで supabase/migrations を先頭から再適用するための下地。
-- 本番(Supabase)が提供する auth スキーマ／ロール／拡張の最小スタブを用意する。
-- 用途: 「migrations だけから空DBを再構築できるか」を検証する（migration の順序崩れを検出する）。
--
-- 使い方:
--   createdb -h 127.0.0.1 -p <port> -U postgres mig_test
--   psql ... -f supabase/tests/_local_bootstrap.sql
--   for f in supabase/migrations/*.sql; do psql ... -f "$f"; done

create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";

-- Supabase のロール
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;

-- auth スキーマ（本番の GoTrue が持つ列のうち、migration が参照するものだけ）
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  phone text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'authenticated');
$$;

create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$$;
