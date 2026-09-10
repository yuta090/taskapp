-- =============================================================================
-- GitHub 連携テーブル RLS（社内メンバー限定）検証ハーネス: 事前スタブ
-- baseline_stubs.sql の後・20240205_000_github_integration.sql の前に流す。
--
-- 20240205 の2本（GitHub 連携の元定義）が参照する auth.users / tasks だけを最小スタブし、
-- Supabase 既定の表権限（authenticated に select/insert/update/delete。行は RLS で絞る）を再現する。
-- github_* の DDL は一切書かない（実 migration を verbatim 適用して作る）。使い捨てクラスタ専用。
-- =============================================================================
set client_min_messages = warning;

-- 20240205_000 の created_by（auth.users への外部キー）の参照先
create table if not exists auth.users (
  id uuid primary key
);

-- 20240205_000 の task_github_links.task_id（外部キー）の参照先。
--   20240205_001 のトリガー/ポリシーが org_id / space_id を、
--   20260703_002 / 010 の tasks ポリシーが client_scope / ball を参照する。
create table if not exists public.tasks (
  id uuid primary key,
  org_id uuid not null references public.organizations(id),
  space_id uuid not null references public.spaces(id),
  title text not null default '',
  ball text not null default 'internal',
  client_scope text
);

-- Supabase 既定の権限: authenticated は表そのものには触れる（見える行は RLS が決める）
grant usage on schema public, auth to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
-- 以降の migration が作る表（github_* 等）にも同じ既定権限を付ける
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
