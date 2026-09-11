-- =============================================================================
-- 議事録の要約を作る関数（rpc_generate_meeting_minutes）は、ログインした人とサーバーだけが実行できる
--
-- 規則: rpc_generate_meeting_minutes(uuid) を実行できるのは authenticated（中で会議の space のメンバーかを確かめる）と
--   service_role（議事録メールの Edge Function）だけ。PUBLIC と anon には実行権を付けない。
--   関数の本文・持ち主・SECURITY DEFINER・search_path は変えない。
--
-- 冪等: revoke / grant は何度流しても同じ。2回流しても同じ。
-- 可逆: 末尾のロールバック節。データは変えない。
-- =============================================================================

revoke execute on function public.rpc_generate_meeting_minutes(uuid) from public, anon;
grant execute on function public.rpc_generate_meeting_minutes(uuid) to authenticated, service_role;

-- 確認: PUBLIC・anon は実行できず、authenticated・service_role は実行できる（違えば止める）
do $$
declare
  v_fn constant regprocedure := 'public.rpc_generate_meeting_minutes(uuid)'::regprocedure;
begin
  if exists (select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
              where p.oid = v_fn and a.grantee = 0 and a.privilege_type = 'EXECUTE')
     or has_function_privilege('anon', v_fn, 'execute')
     or not has_function_privilege('authenticated', v_fn, 'execute')
     or not has_function_privilege('service_role', v_fn, 'execute') then
    raise exception 'meeting minutes rpc rights: rpc_generate_meeting_minutes の実行権が想定と違います: %',
      (select p.proacl::text from pg_proc p where p.oid = v_fn);
  end if;
end $$;

-- ロールバック:
--   grant execute on function public.rpc_generate_meeting_minutes(uuid) to public, anon;
-- =============================================================================
-- 検証:
--   0) ローカル: bash scripts/verify-migrations-from-scratch.sh（anon が実行できる SECURITY DEFINER の許容リスト
--      supabase/tests/allowlist/anon_definer_functions.txt に、この関数は載っていない）。
--   1) 適用後（本番）:
--        select has_function_privilege('anon', 'public.rpc_generate_meeting_minutes(uuid)', 'execute'),
--               has_function_privilege('authenticated', 'public.rpc_generate_meeting_minutes(uuid)', 'execute'),
--               has_function_privilege('service_role', 'public.rpc_generate_meeting_minutes(uuid)', 'execute');
--          → f / t / t
-- =============================================================================
