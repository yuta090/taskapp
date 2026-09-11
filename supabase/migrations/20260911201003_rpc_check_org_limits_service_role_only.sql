-- =============================================================================
-- rpc_check_org_limits はサーバー（service role）と DB の中の関数からだけ呼ぶ
--
-- 規則: 実行権は service_role だけ（public / anon / authenticated は持たない）。本文は変えない。
--   DB の中の呼び出し元（rpc_create_invite / rpc_accept_invite）は SECURITY DEFINER（持ち主 postgres）なので、
--   この実行権の影響を受けない。
--   アプリの呼び出し（src/app/api/billing/limits/route.ts）は、所属を確かめたあと管理用の鍵（service role）で呼ぶ。
--   その版が本番に出てから当てる。
--
-- 冪等: revoke → grant。2回流しても同じ。
-- 可逆: 節 1 の末尾のロールバック節。データは変えない。
-- =============================================================================


-- =============================================================================
-- 節 1: rpc_check_org_limits の実行権を service_role だけにする
-- =============================================================================

revoke execute on function public.rpc_check_org_limits(uuid) from public, anon, authenticated;
grant execute on function public.rpc_check_org_limits(uuid) to service_role;

-- 確認: public / anon / authenticated が実行できず、service_role は実行できる（別の付与者から付いた実行権が残っていれば止める）
do $$
declare
  v_fn constant text := 'public.rpc_check_org_limits(uuid)';
begin
  if has_function_privilege('public', v_fn, 'execute')
     or has_function_privilege('anon', v_fn, 'execute')
     or has_function_privilege('authenticated', v_fn, 'execute')
     or not has_function_privilege('service_role', v_fn, 'execute') then
    raise exception 'rpc_check_org_limits: 実行権が service_role だけになっていません: %',
      (select p.proacl from pg_proc p where p.oid = v_fn::regprocedure);
  end if;
end $$;

-- ロールバック（節 1。実行権は、適用前に控えた proacl と違えばそれに合わせる）:
--   grant execute on function public.rpc_check_org_limits(uuid) to public, anon, authenticated;
-- =============================================================================
-- 検証:
--   0) ローカル: bash supabase/tests/run_function_default_privileges.sh（全 PASS）。RED=1 で本 migration 抜き。
--   1) 適用前（本番）: 戻すときのために今の実行権を控える:
--        select proacl from pg_proc where oid = 'public.rpc_check_org_limits(uuid)'::regprocedure;
--   2) 適用後（本番）:
--        select has_function_privilege('anon', 'public.rpc_check_org_limits(uuid)', 'execute'),
--               has_function_privilege('authenticated', 'public.rpc_check_org_limits(uuid)', 'execute'),
--               has_function_privilege('service_role', 'public.rpc_check_org_limits(uuid)', 'execute');   → f f t
--   3) 画面: プランと請求の画面に使用状況（人数・プロジェクト数）が出る／招待の作成と受諾が人数の上限で止まる・通る。
-- =============================================================================
