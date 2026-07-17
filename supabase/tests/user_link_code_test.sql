-- 内部ユーザーのLINE本人紐付け（Stage 2.7-A）の挙動検証。スクラッチDB・使い捨て。
-- 最小の依存テーブルを作ってから *実際の migration* を適用し、rpc_consume_user_link_code の
-- 契約（例外を投げない・失敗も履歴に残る・conflictではコードを消費しない・ロックは窓で自然解除）を検証する。
--
-- 実行:
--   createdb -h 127.0.0.1 -p 55432 -U postgres ul_test
--   psql ... -d ul_test -f supabase/tests/user_link_code_test.sql
--   psql ... -d ul_test -f supabase/migrations/<ts>_channel_user_links.sql
--   psql ... -d ul_test -f supabase/tests/user_link_code_assert.sql
--
-- 本ファイルは「下地」。アサーションは user_link_code_assert.sql 側に置き、
-- 間に本物の migration を挟むことで、テストが実装を先取りしないようにする。

set client_min_messages = warning;

create extension if not exists pgcrypto;

-- Supabase 相当の最小スタブ
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid());
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'org'
);

create table if not exists public.channel_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  channel text not null default 'line',
  display_name text not null default 'secretary'
);

-- 固定IDのフィクスチャ（アサーション側から参照する）
insert into public.organizations (id, name) values
  ('00000000-0000-4000-8000-000000000001', 'org-A'),
  ('00000000-0000-4000-8000-000000000002', 'org-B')
on conflict do nothing;

insert into auth.users (id) values
  ('00000000-0000-4000-8000-0000000000a1'),  -- user1（org-A の内部メンバー）
  ('00000000-0000-4000-8000-0000000000a2')   -- user2（org-A の別の内部メンバー）
on conflict do nothing;

insert into public.channel_accounts (id, org_id) values
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-000000000001'),  -- account-A
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-000000000002')   -- account-B（別org）
on conflict do nothing;
