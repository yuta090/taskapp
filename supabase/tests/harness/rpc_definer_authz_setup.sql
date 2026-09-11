-- =============================================================================
-- 関数の実行権と呼んだ人の確認（*_rpc_definer_authz.sql）の検証ハーネス用: Supabase が本番で持っている権限の代役
-- _local_bootstrap.sql の後・migrations の前に流す（migration は1行も変えない）。
--
--   1) public に作った表・関数・シーケンスは anon / authenticated / service_role にも付く（Supabase の既定）。
--      これが無いと関数の権限（誰が呼べるか）が本番と違う形になる。
--   2) auth.uid() は本物（GoTrue）と同じく request.jwt.claims の sub も読む。
--   3) authenticated が auth スキーマの関数（ポリシーの auth.uid()）を呼べる。
--   4) service_role は RLS を通らない（本物と同じ bypassrls）。
-- =============================================================================

alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;

create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid;
$$;

grant execute on function auth.uid(), auth.role(), auth.jwt() to anon, authenticated, service_role;

alter role service_role bypassrls;
