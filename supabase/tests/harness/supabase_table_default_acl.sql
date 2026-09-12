-- =============================================================================
-- Supabase が本番で持っている「表・ビュー・シーケンスの既定の付与」の代役
--   （2026-09-12 に本番の pg_default_acl で確かめた、*_table_privileges.sql を当てる前の形）
-- _local_bootstrap.sql の後・migrations の前に流す（migration は1行も変えない）。
--
--   postgres が public に作る表・ビュー・シーケンスには、anon / authenticated / service_role にも全部付く（スキーマ単位の既定）。
--   *_table_privileges.sql が、この既定を「anon には付けない・authenticated は表とビューなら select / insert / update / delete、
--   シーケンスなら usage だけ」に変える。
--   これが無いと、空の DB では anon / authenticated に表の権限がほとんど付かず、表・ビュー・シーケンスの権限の検査が
--   確かめにならない（本番で付いてしまう物が、空の DB では付かないため）。
--
-- 使うもの: scripts/verify-migrations-from-scratch.sh・supabase/tests/run_table_privileges.sh
--   _local_bootstrap.sql には入れない（ハーネスは代役を自分で選んで流す作りで、多くは space_role_boundary_setup.sql か
--   rpc_definer_authz_setup.sql で同じ既定を付けている。bootstrap に入れると、代役を選ばないハーネス
--   〈run_scheduling_cron_register.sh〉の前提が変わる）。
-- =============================================================================

alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
