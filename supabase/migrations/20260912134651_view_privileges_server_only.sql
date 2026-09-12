-- =============================================================================
-- 連携の状態のビューと AI 利用の月の集計のビューは、サーバー（service_role）だけが使う
--
-- 規則:
--   public.system_integration_status（連携ごとの有効 / 無効）: anon / authenticated は読み書きしない。
--     security_invoker = true（読む人の権限で、元の表 system_integration_configs の RLS が効く）。
--   public.app_org_ai_usage_monthly（組織ごとの AI 利用の月の集計）: anon / authenticated は読まない。
--     security_invoker = true（元の表 ai_usage_events の RLS が効く）。
--   public.system_integration_configs: anon は表の権限を持たない。authenticated は select / insert / update / delete
--     だけ（行は RLS で運営だけ）。
--   どちらのビューも、アプリはサーバーの鍵で使う（画面から本人の権限では読まない）。
-- 冪等: revoke / grant / alter view set は2回流しても同じ。
-- 可逆: 節ごとの末尾のロールバック節。
-- =============================================================================


-- =============================================================================
-- 節 1: system_integration_status
-- =============================================================================

revoke all on table public.system_integration_status from public, anon, authenticated;
alter view public.system_integration_status set (security_invoker = true);

-- ロールバック（節 1。読むだけを authenticated に戻す）:
--   alter view public.system_integration_status reset (security_invoker);
--   grant select on table public.system_integration_status to authenticated;
-- =============================================================================
-- 節 2: app_org_ai_usage_monthly
-- =============================================================================

revoke all on table public.app_org_ai_usage_monthly from public, anon, authenticated;
alter view public.app_org_ai_usage_monthly set (security_invoker = true);

-- ロールバック（節 2）:
--   alter view public.app_org_ai_usage_monthly reset (security_invoker);
-- =============================================================================
-- 節 3: system_integration_configs の表の権限
-- =============================================================================

revoke all on table public.system_integration_configs from anon;
revoke all on table public.system_integration_configs from authenticated;
grant select, insert, update, delete on table public.system_integration_configs to authenticated;

-- ロールバック（節 3。表の権限を戻す。行は RLS で運営だけのまま）:
--   grant all on table public.system_integration_configs to authenticated;
-- =============================================================================
-- 節 4: 末尾の確認（何も変えない）
-- =============================================================================

do $$
declare
  v_bad text := '';
begin
  if has_table_privilege('anon', 'public.system_integration_status', 'select, insert, update, delete')
     or has_table_privilege('authenticated', 'public.system_integration_status', 'select, insert, update, delete') then
    v_bad := v_bad || ' system_integration_status に anon / authenticated の権限;';
  end if;
  if has_table_privilege('anon', 'public.app_org_ai_usage_monthly', 'select, insert, update, delete')
     or has_table_privilege('authenticated', 'public.app_org_ai_usage_monthly', 'select, insert, update, delete') then
    v_bad := v_bad || ' app_org_ai_usage_monthly に anon / authenticated の権限;';
  end if;
  if not exists (select 1 from pg_class c where c.oid = 'public.system_integration_status'::regclass
                   and c.reloptions @> array['security_invoker=true']) then
    v_bad := v_bad || ' system_integration_status が security_invoker でない;';
  end if;
  if not exists (select 1 from pg_class c where c.oid = 'public.app_org_ai_usage_monthly'::regclass
                   and c.reloptions @> array['security_invoker=true']) then
    v_bad := v_bad || ' app_org_ai_usage_monthly が security_invoker でない;';
  end if;
  if exists (select 1 from pg_class c, aclexplode(c.relacl) a
              where c.oid = 'public.system_integration_configs'::regclass
                and a.grantee = 'anon'::regrole) then
    v_bad := v_bad || ' system_integration_configs に anon の権限;';
  end if;
  if exists (select 1 from pg_class c, aclexplode(c.relacl) a
              where c.oid = 'public.system_integration_configs'::regclass
                and a.grantee = 'authenticated'::regrole
                and a.privilege_type not in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')) then
    v_bad := v_bad || ' system_integration_configs の authenticated に余計な権限;';
  end if;
  if v_bad <> '' then
    raise exception 'view privileges server only: 想定と違います:%', v_bad;
  end if;
end $$;

-- ロールバック（節 4）: なし（確かめるだけで、何も変えない）
