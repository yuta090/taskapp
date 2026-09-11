-- =============================================================================
-- SECURITY DEFINER の関数の search_path（*_definer_search_path.sql）の検証ハーネス用: 拡張の置き場所の代役
-- _local_bootstrap.sql と rpc_definer_authz_setup.sql の後・migrations の前に流す（migration は1行も変えない）。
--
--   1) pgcrypto は本番（Supabase）と同じく extensions スキーマに置く。
--      _local_bootstrap.sql は public に入れるので、ここで移す（public にあると関数の search_path を確かめられない）。
--   2) extensions の関数は anon / authenticated / service_role も使える（Supabase の既定）。
--   3) migration を流すセッション（postgres）の search_path は本番と同じく extensions を含む。
-- =============================================================================

create schema if not exists extensions;
alter extension pgcrypto set schema extensions;

grant usage on schema extensions to anon, authenticated, service_role;

alter role postgres set search_path = "$user", public, extensions;
