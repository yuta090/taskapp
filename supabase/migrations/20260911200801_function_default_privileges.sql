-- =============================================================================
-- public に作る関数の実行権は既定で付けない
--
-- 規則: public に作る関数の実行権は既定で付けない。作った migration の中で、呼ぶ役割に明示で grant する
--   （RLS のポリシーが呼ぶ補助関数は authenticated に grant する）。
--   変えるのは postgres が作る関数の既定（alter default privileges for role postgres）だけ:
--     スキーマ public の既定から anon / authenticated を外す（service_role は残す）
--     全体の既定から PUBLIC を外す（PUBLIC は全体の既定で付くので、スキーマ単位の revoke では外せない）
--   既にある関数の実行権は変えない（create or replace も既にある実行権を保つ）。
--   drop してから作り直す関数は、新しく作る関数と同じ扱いになる（呼ぶ役割に grant し直す）。
--
-- 冪等: alter default privileges … revoke は何度流しても同じ。2回流しても同じ。
-- 可逆: 節 1 の末尾のロールバック節。データも、既にある関数・表の権限も変えない。
-- =============================================================================


-- =============================================================================
-- 節 1: postgres が作る関数の既定の実行権から anon / authenticated / PUBLIC を外す
-- =============================================================================

alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;
alter default privileges for role postgres revoke execute on functions from public;

-- 確認: postgres が public に新しく作る関数に、anon / authenticated / PUBLIC の実行権が既定で付かない（違えば止める）
--   スキーマ public の既定に anon / authenticated が無い。全体の既定があり（無い = 組み込みの既定 = PUBLIC に付く）、
--   そこに PUBLIC が無い。
do $$
declare
  v_schema aclitem[];
  v_global aclitem[];
begin
  select d.defaclacl into v_schema
    from pg_default_acl d
   where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 'public'::regnamespace and d.defaclobjtype = 'f';
  select d.defaclacl into v_global
    from pg_default_acl d
   where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 0 and d.defaclobjtype = 'f';

  if exists (select 1 from aclexplode(coalesce(v_schema, '{}'::aclitem[])) a
              where a.grantee in ('anon'::regrole::oid, 'authenticated'::regrole::oid) and a.privilege_type = 'EXECUTE') then
    raise exception 'function default privileges: スキーマ public の既定に anon / authenticated の実行権が残っています: %', v_schema;
  end if;
  if v_global is null
     or exists (select 1 from aclexplode(v_global) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') then
    raise exception 'function default privileges: 全体の既定で PUBLIC に実行権が付きます: %', coalesce(v_global::text, '(組み込みの既定)');
  end if;
end $$;

-- ロールバック（節 1。元の既定に戻す）:
--   alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated;
--   alter default privileges for role postgres grant execute on functions to public;
-- =============================================================================
-- 検証:
--   0) ローカル: bash supabase/tests/run_function_default_privileges.sh（全 PASS）。RED=1 で本 migration 抜き。
--      scripts/verify-migrations-from-scratch.sh は、ポリシーが呼ぶ関数を authenticated が実行できるか・実行権が
--      null の関数が無いか・anon が実行できる SECURITY DEFINER の関数が許容リスト
--      （supabase/tests/allowlist/anon_definer_functions.txt）の中だけかを検査する。
--   1) 適用後（本番）:
--        select defaclnamespace::regnamespace, defaclacl from pg_default_acl
--         where defaclrole = 'postgres'::regrole and defaclobjtype = 'f';
--          → public: {postgres=X/postgres,service_role=X/postgres} ／ 全体（-）: {postgres=X/postgres}
--      既にある関数の実行権は変わらない（適用の前後で
--        select oid::regprocedure, proacl from pg_proc where pronamespace = 'public'::regnamespace order by 1 を比べる）。
-- =============================================================================
