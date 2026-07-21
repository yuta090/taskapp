-- =============================================================================
-- 共通LINE org別クォータ 定期フル再同期 app_resync_all_org_push_quota() 検証
-- 前提: overview harness の全chain → org_billing_stub(b1 free/b2 pro) → 201858(trigger+backfill) →
--   resync_setup(c9 billing無し・b1 を 999 に汚す) → 205553(resync migration・適用時 resync 実行) を
--   verbatim 適用済みの使い捨てクラスタ。実行は run_org_push_quota_resync.sh。
--
-- 検証:
--   (#2) org_billing 無し org(c9) が適用時 resync で monthly_push_quota=50 になる。
--   (drift) 誤値 999 に汚した b1(free) が resync で 50 に是正される。
--   (unchanged) b2(pro) は NULL のまま。
--   (idempotent) 変化が無ければ2回目の resync は 0 行。
--   (grant) service_role が app_platform_budget_overview() を実行できる（42501 にならない）。
-- =============================================================================
set client_min_messages = notice;

create or replace function assert_eq(label text, got anyelement, want anyelement) returns void
language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FAIL[%]: got %, want %', label, got, want;
  else raise notice 'PASS[%]: %', label, coalesce(got::text, 'NULL'); end if;
end $$;

create or replace function quota_of(p_org uuid) returns int
language sql stable as $$
  select monthly_push_quota from public.org_channel_policy where org_id = p_org
$$;

create or replace function on_exceed_of(p_org uuid) returns text
language sql stable as $$
  select on_exceed from public.org_channel_policy where org_id = p_org
$$;

-- ---- 適用時 resync の結果 ----------------------------------------------------
select assert_eq('resync_billingless_c9_50', quota_of('00000000-0000-0000-0000-0000000000c9'), 50);
select assert_eq('resync_stale_b1_corrected_50', quota_of('00000000-0000-0000-0000-0000000000b1'), 50);
select assert_eq('resync_pro_b2_still_null', quota_of('00000000-0000-0000-0000-0000000000b2'), null::int);
-- on_exceed も適用時 backfill でプラン由来に揃う（free=block=実抑止 / paid=none）
select assert_eq('resync_c9_free_block', on_exceed_of('00000000-0000-0000-0000-0000000000c9'), 'block');
select assert_eq('resync_b1_free_block', on_exceed_of('00000000-0000-0000-0000-0000000000b1'), 'block');
select assert_eq('resync_b2_pro_none', on_exceed_of('00000000-0000-0000-0000-0000000000b2'), 'none');

-- ---- idempotent: もう変化が無いので0行 --------------------------------------
select assert_eq('resync_idempotent_zero', public.app_resync_all_org_push_quota(), 0);

-- ---- on_exceed drift: quotaは正しい(50)がon_exceedだけ'none'に汚れたケースを resync が是正する
--   （205553旧版は quota しか直さず on_exceed を取り残す穴。本migrationで塞いだことの回帰）。
update public.org_channel_policy set on_exceed='none'
  where org_id='00000000-0000-0000-0000-0000000000c9';
select assert_eq('resync_on_exceed_drift_updates_1row', public.app_resync_all_org_push_quota(), 1);
select assert_eq('resync_on_exceed_corrected_to_block', on_exceed_of('00000000-0000-0000-0000-0000000000c9'), 'block');
select assert_eq('resync_idempotent_after_on_exceed_fix', public.app_resync_all_org_push_quota(), 0);

-- ---- (grant) service_role が overview を実行できる（未grantなら 42501 で ON_ERROR_STOP 失敗） ----
set role service_role;
select assert_eq('service_role_overview_executes',
  (select count(*) >= 0 from public.app_platform_budget_overview()), true);
reset role;

-- ---- done -------------------------------------------------------------------
do $$ begin raise notice 'ORG PUSH QUOTA RESYNC CHECKS PASSED'; end $$;
