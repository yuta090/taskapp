-- =============================================================================
-- 共通LINE org別クォータ: 定期フル再同期（トリガーの穴を塞ぐ）
-- 設計正本: src/lib/billing/entitlements.ts / 20260720201858_org_push_quota_from_plan.sql
-- コードレビュー(Codex 2026-07-20)指摘 #2/#3 への対応。
--
-- トリガー trg_org_billing_sync_push_quota は org_billing への「書込」でしか発火しない。
-- そのため次の2ケースで quota が実態とズレ、無制限のまま残りうる:
--   (#2) organizations はあるが org_billing 行が無い org（旧データ・作成失敗）→ backfill 対象外で NULL のまま。
--   (#3) past_due の14日猶予が「時間経過だけ」で切れるケース→ billing 側に書込が無くトリガー未発火、
--        reconcile も差分無しなら書かないため NULL(無制限)が永続。TSのentitlementは free になり乖離。
--
-- 対策: organizations 起点(LEFT JOIN org_billing)で全org の quota を app_org_push_quota() で
-- 再計算して upsert する冪等関数を用意し、pg_cron で日次実行する。billing 欠落は
-- app_org_push_quota(NULL,...) が free=50 に fail-close するので自動的に 50 が入る。
-- now() で猶予判定するので、日次実行で猶予切れの drift も翌日には是正される。
-- =============================================================================

create or replace function public.app_resync_all_org_push_quota()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  with desired as (
    select o.id as org_id,
           public.app_org_push_quota(b.plan_id, b.status, b.current_period_end) as q
    from public.organizations o
    left join public.org_billing b on b.org_id = o.id
  )
  insert into public.org_channel_policy (org_id, monthly_push_quota)
  select org_id, q from desired
  on conflict (org_id) do update
    set monthly_push_quota = excluded.monthly_push_quota,
        updated_at = now()
    where public.org_channel_policy.monthly_push_quota is distinct from excluded.monthly_push_quota;
  get diagnostics v_updated = row_count;   -- 実際に作成/変更した行数（変化なしは触らない）
  return v_updated;
end;
$$;

revoke all on function public.app_resync_all_org_push_quota() from public, anon, authenticated;

-- 適用時に一度フル再同期（billing 欠落 org を含め現状へ揃える）。
select public.app_resync_all_org_push_quota();

-- 日次スケジュール（pg_cron がある環境のみ）。トリガーが即時性、これが最終的整合性を担保する。
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from cron.job where jobname = 'org-push-quota-resync') then
      perform cron.schedule(
        'org-push-quota-resync',
        '20 15 * * *',   -- 毎日 15:20 UTC（= 翌 00:20 JST 相当）。厳密な時刻は問わない（日次で十分）。
        'select public.app_resync_all_org_push_quota()'
      );
    end if;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 運用者可視化関数を service_role からも実行可能にする（Codex 指摘 Rec#4）。
-- ランブックが「service role / SQLコンソールで使う」と書いているが、PUBLIC から revoke 後に
-- service_role へ grant していなかったため PostgREST(service key)経由では 42501 になっていた。
-- SQLコンソール(owner)実行に加え、service_role RPC でも呼べるようにする。
-- -----------------------------------------------------------------------------
grant execute on function public.app_platform_budget_overview() to service_role;

-- =============================================================================
-- 検証（run_org_push_quota_resync.sh）:
--   (#2) org_billing 行が無い org が適用時 resync で monthly_push_quota=50 になる。
--   (drift) stale に NULL/誤値を入れた free org が resync 実行で 50 に是正される。
--   (idempotent) 変化が無ければ2回目の resync は 0 行更新。
--   (grant) service_role が app_platform_budget_overview() を実行できる。
-- ロールバック:
--   select cron.unschedule('org-push-quota-resync');  -- pg_cron 環境のみ
--   drop function if exists public.app_resync_all_org_push_quota();
--   revoke execute on function public.app_platform_budget_overview() from service_role;
-- =============================================================================
