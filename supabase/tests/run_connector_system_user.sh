#!/usr/bin/env bash
# =============================================================================
# コネクタ・システムユーザー migration 検証ハーネス（throwaway クラスタ）
#
# 20260720210220_connector_system_user.sql の (a)seed / (b)profiles / (d)backfill を、
# GoTrue 形状に寄せた auth.users（generated `confirmed_at` を含む）＋ 実 profiles トリガー
# （on_auth_user_created）に対して検証する。Fable 検証項目 #1/#4/#6 のうち、この migration
# 固有の novel risk（generated column が INSERT を弾かないか・トリガーとの相互作用・backfill 境界）
# を de-risk する。使い捨てクラスタを起動し終了時に破棄。本番DBには触れない。
#
# 使い方: bash supabase/tests/run_connector_system_user.sh
# 必要: initdb / pg_ctl / psql / createdb が PATH（PG14+）。
# =============================================================================
set -euo pipefail

TST="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$TST/../.." && pwd)"
MIG="$REPO/supabase/migrations"

WORK="$(mktemp -d /tmp/csu.XXXXXX)"
PGDATA="$WORK/data"
SOCK="$WORK/s"
PORT=54417
mkdir -p "$SOCK"

cleanup() {
  pg_ctl -D "$PGDATA" -w stop >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "== init throwaway cluster =="
initdb -D "$PGDATA" -U postgres --auth=trust >/dev/null 2>&1
pg_ctl -D "$PGDATA" -o "-p $PORT -k $SOCK -c listen_addresses=''" -w start >/dev/null 2>&1
createdb -h "$SOCK" -p "$PORT" -U postgres scratch
CONN="host=$SOCK port=$PORT user=postgres dbname=scratch"

psql "$CONN" -v ON_ERROR_STOP=1 -q <<'SQL'
create extension if not exists pgcrypto;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;

-- GoTrue 形状に寄せた auth.users（migration が触る列＋generated confirmed_at を含む）。
create schema if not exists auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid,
  aud varchar(255),
  role varchar(255),
  email text,
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  phone text,
  phone_confirmed_at timestamptz,
  banned_until timestamptz,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 本番 GoTrue と同じく generated column。migration の INSERT がこれを触ると失敗するので回帰を張る。
  confirmed_at timestamptz generated always as (least(email_confirmed_at, phone_confirmed_at)) stored
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'authenticated') $$;

-- profiles ＋ 実トリガー（20240203_000_profiles.sql / 20260706082225 と同一ロジック）。
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create or replace function handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(nullif(new.raw_user_meta_data->>'name',''),
                           nullif(split_part(new.email,'@',1),''), 'User'))
  on conflict (id) do update set display_name = coalesce(nullif(excluded.display_name,''), profiles.display_name, 'User');
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

-- RPC/backfill が参照する最小テーブル（backfill は plain UPDATE なので tasks トリガーは不要）。
create table integration_connections (id uuid primary key, org_id uuid not null);
create table spaces (id uuid primary key, org_id uuid not null);
create table tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid, space_id uuid, title text not null, description text not null default '',
  status text, ball text, origin text, type text, client_scope text,
  created_by uuid not null references auth.users(id)
);
create table connector_task_links (
  connection_id uuid, task_id uuid references tasks(id), external_id text, origin text,
  unique(connection_id, external_id)
);

-- 事前データ: 実ユーザー owner ＋ backfill 対象/非対象タスク。
insert into auth.users (id, email, raw_user_meta_data)
  values ('11111111-1111-4111-a111-111111111111','owner@example.com','{"name":"実オーナー"}'::jsonb);
insert into integration_connections values ('22222222-2222-4222-a222-222222222222','aaaaaaaa-0000-4000-a000-000000000000');
insert into spaces values ('33333333-3333-4333-a333-333333333333','aaaaaaaa-0000-4000-a000-000000000000');
-- external 由来(backfill 対象): owner 名義で作られている
insert into tasks (id, org_id, space_id, title, status, ball, origin, type, client_scope, created_by)
  values ('44444444-4444-4444-a444-444444444444','aaaaaaaa-0000-4000-a000-000000000000',
          '33333333-3333-4333-a333-333333333333','ext task','todo','internal','internal','task','internal',
          '11111111-1111-4111-a111-111111111111');
insert into connector_task_links values ('22222222-2222-4222-a222-222222222222','44444444-4444-4444-a444-444444444444','ext-1','external');
-- internal 由来(mirror 元・backfill 非対象): owner 名義のまま不変であること
insert into tasks (id, org_id, space_id, title, status, ball, origin, type, client_scope, created_by)
  values ('55555555-5555-4555-a555-555555555555','aaaaaaaa-0000-4000-a000-000000000000',
          '33333333-3333-4333-a333-333333333333','int task','todo','internal','internal','task','internal',
          '11111111-1111-4111-a111-111111111111');
insert into connector_task_links values ('22222222-2222-4222-a222-222222222222','55555555-5555-4555-a555-555555555555','int-1','internal');
SQL

echo "== apply migration verbatim =="
# -1（single transaction）で適用: migration 内の `set local session_replication_role` を有効化し、
# Supabase CLI が各 migration を1トランザクションで包む挙動を忠実に再現する。
psql "$CONN" -v ON_ERROR_STOP=1 -q -1 -f "$MIG/20260720210220_connector_system_user.sql"

echo "== assertions =="
psql "$CONN" -v ON_ERROR_STOP=1 -q <<'SQL'
do $$
declare v uuid := '00000000-0000-4000-a000-000000000001'; n int; d text; cb uuid;
begin
  -- (a) seed 成功（generated confirmed_at が INSERT を弾かない）
  if not exists (select 1 from auth.users where id=v) then raise exception 'FAIL: system user not seeded'; end if;
  -- banned_until 遠未来（ログイン不能の主担保）
  if (select banned_until from auth.users where id=v) < now() + interval '100 years'
     then raise exception 'FAIL: banned_until not far-future'; end if;
  -- encrypted_password は NULL のまま（password grant 不成立）
  if (select encrypted_password from auth.users where id=v) is not null
     then raise exception 'FAIL: encrypted_password should be NULL'; end if;
  -- (b) profiles: 決定的に「外部連携（システム）」（トリガー既定 'User' で終わらない）
  select display_name into d from profiles where id=v;
  if d is distinct from '外部連携（システム）' then raise exception 'FAIL: profile display_name=%', d; end if;
  -- (d) backfill: external 由来のみシステムユーザーへ
  select created_by into cb from tasks where id='44444444-4444-4444-a444-444444444444';
  if cb is distinct from v then raise exception 'FAIL: external task not backfilled (created_by=%)', cb; end if;
  -- internal 由来(mirror 元)は不変
  select created_by into cb from tasks where id='55555555-5555-4555-a555-555555555555';
  if cb <> '11111111-1111-4111-a111-111111111111' then raise exception 'FAIL: internal task wrongly backfilled (created_by=%)', cb; end if;
  -- 冪等: 再適用してもエラーにならず二重にならない
  raise notice 'ALL PASS: seed+profiles+backfill';
end $$;
SQL

echo "== (c) RPC attribution + fail-loud =="
# identity 境界変更の核: RPC 経由(multica inbound task.created 相当)の起票がシステムユーザー名義になり、
# system 未 seed 環境では明示的に fail-loud することを、実 RPC を呼んで検証する。
psql "$CONN" -v ON_ERROR_STOP=1 -q <<'SQL'
-- 正の経路: RPC 起票 → created_by=システムユーザー・link origin=external・冪等
do $$
declare v uuid := '00000000-0000-4000-a000-000000000001'; tid uuid; tid2 uuid; cb uuid; lorigin text;
begin
  tid := public.rpc_connector_create_task(
    '22222222-2222-4222-a222-222222222222','ext-new',
    '33333333-3333-4333-a333-333333333333','新規タイトル', null);
  select created_by into cb from tasks where id = tid;
  if cb is distinct from v then raise exception 'FAIL: RPC created_by=% (expected system user)', cb; end if;
  select origin into lorigin from connector_task_links
    where connection_id='22222222-2222-4222-a222-222222222222' and external_id='ext-new';
  if lorigin is distinct from 'external' then raise exception 'FAIL: RPC link origin=%', lorigin; end if;
  -- 冪等: 同一 external_id 再送は同じ task を返す(重複起票しない)
  tid2 := public.rpc_connector_create_task(
    '22222222-2222-4222-a222-222222222222','ext-new',
    '33333333-3333-4333-a333-333333333333','別タイトル', null);
  if tid2 is distinct from tid then raise exception 'FAIL: RPC not idempotent on resend'; end if;
  raise notice 'RPC ATTRIBUTION OK';
end $$;

-- fail-loud: システムユーザー未 seed 環境では明示例外。参照行を退避して system を一時削除し RPC を叩く。
-- 内側 BEGIN..EXCEPTION はサブトランザクションなので、RPC が raise した時点で削除ごと自動ロールバックされ
-- system user は復元される(throwaway クラスタなので副作用は無害だが、意味論として正しく閉じる)。
do $$
declare v uuid := '00000000-0000-4000-a000-000000000001'; raised boolean := false;
begin
  begin
    delete from connector_task_links;
    delete from tasks where created_by = v;
    delete from profiles where id = v;
    delete from auth.users where id = v;
    perform public.rpc_connector_create_task(
      '22222222-2222-4222-a222-222222222222','ext-fail',
      '33333333-3333-4333-a333-333333333333','x', null);
  exception when others then
    if sqlerrm like '%connector system user missing%' then raised := true; else raise; end if;
  end;
  if not raised then raise exception 'FAIL: RPC did not fail-loud on missing system user'; end if;
  raise notice 'RPC FAIL-LOUD OK';
end $$;
SQL

echo "== re-apply (idempotency) =="
psql "$CONN" -v ON_ERROR_STOP=1 -q -1 -f "$MIG/20260720210220_connector_system_user.sql"
psql "$CONN" -v ON_ERROR_STOP=1 -q -c "select case when count(*)=1 then 'IDEMPOTENT OK' else 'FAIL: duplicate system user' end from auth.users where id='00000000-0000-4000-a000-000000000001';"

echo "== DONE =="
