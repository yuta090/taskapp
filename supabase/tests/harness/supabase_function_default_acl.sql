-- =============================================================================
-- Supabase が本番で持っている「関数の既定の実行権」の代役（2026-09-11 に本番の pg_default_acl で確かめた形）
-- _local_bootstrap.sql の後・migrations の前に流す（migration は1行も変えない）。
--
--   postgres が public に作る関数には、postgres / anon / authenticated / service_role の実行権が付く（スキーマ単位の既定）。
--   これとは別に、PostgreSQL の組み込みの既定で PUBLIC にも実行権が付く（ここでは何もしない）。
--   これが無いと、関数の実行権（proacl）が本番と違う形（null）になり、実行権の検査が確かめにならない。
--
-- 使うもの: scripts/verify-migrations-from-scratch.sh・supabase/tests/run_function_default_privileges.sh
-- =============================================================================

alter default privileges for role postgres in schema public grant execute on functions to postgres, anon, authenticated, service_role;
