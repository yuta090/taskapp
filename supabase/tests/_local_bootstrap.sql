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
  -- instance_id / aud / role / banned_until / updated_at は 20260720210220_connector_system_user.sql の
  -- システムユーザー作成が使う（型は本番に合わせてある）
  instance_id uuid,
  aud varchar(255),
  role varchar(255),
  email text,
  phone text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  banned_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  -- 合言葉（トークン）系の列。20260722085634_fix_auth_user_null_tokens.sql が NULL を '' に直す
  confirmation_token varchar(255),
  recovery_token varchar(255),
  email_change varchar(255),
  email_change_token_new varchar(255),
  email_change_token_current varchar(255) default '',
  phone_change text default '',
  phone_change_token varchar(255) default '',
  reauthentication_token varchar(255) default ''
);

-- 二要素認証（mfa_rls_enforcement / mfa_pre_request が参照）。本物は GoTrue が作る
create table if not exists auth.mfa_factors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  friendly_name text,
  factor_type text not null default 'totp',
  status text not null default 'unverified',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- PostgREST のロール（authenticator）。本物は Supabase が作る
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator noinherit login; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'authenticated');
$$;

create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$$;

-- 連携トークン暗号化の migration（20260717075717 / 20260723110839）は、本番では psql セッションで
-- set app.system_encryption_key = '<SYSTEM_ENCRYPTION_KEY>' してから流す。空DBでは暗号化する行が無いので、
-- 確認専用の仮の値をDB単位で入れておく（migration ごとに別の psql セッションで流すため、set では足りない）。
do $$ begin
  execute format(
    'alter database %I set app.system_encryption_key = %L',
    current_database(),
    'local-verify-only-not-a-real-key-000000000000000000000000000000'
  );
end $$;

-- storage スキーマ（ファイル置き場。本物は Supabase Storage が作る）。
-- migration が参照する列だけ（buckets への登録と、objects への RLS ポリシー）
create schema if not exists storage;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  owner uuid,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,
  metadata jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table storage.objects enable row level security;

-- 本番の定義をそのまま写したもの（2026-09-10 に pg_get_functiondef で確認）
create or replace function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1 : array_length(_parts, 1) - 1];
end
$$;

-- realtime スキーマ（Realtime の private チャネルの認可。本物は Supabase Realtime が作る）。
-- migration が参照するものだけ（realtime.messages への RLS ポリシーと、ポリシーが呼ぶ realtime.topic()）。
-- 本物の realtime.messages は日ごとに区切った表（パーティション）だが、ここでは普通の表で代える。
-- 既にあるときは作り直さない（表・関数は無いときだけ作る。RLS は無効のときだけ有効にする）。
create schema if not exists realtime;

create table if not exists realtime.messages (
  id bigint generated by default as identity primary key,
  topic text not null,
  extension text not null,
  payload jsonb,
  event text,
  private boolean default false,
  inserted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  if not (select c.relrowsecurity from pg_class c where c.oid = 'realtime.messages'::regclass) then
    alter table realtime.messages enable row level security;
  end if;
end $$;

-- いま参加しようとしているチャネル名（Realtime が設定 realtime.topic に入れてから、RLS で判定する）
do $$ begin
  if to_regprocedure('realtime.topic()') is null then
    create function realtime.topic() returns text language sql stable as $f$
      select current_setting('realtime.topic', true)
    $f$;
  end if;
end $$;

-- Realtime は anon / authenticated の役割で realtime.messages を読み書きしてみて、通るかどうか（RLS）で判定する。
-- その前提の代役として、表の権限は付けておく（可否はポリシーで決まる）
grant usage on schema realtime to anon, authenticated, service_role;
grant select, insert on table realtime.messages to anon, authenticated, service_role;
