-- =============================================================================
-- 無料50通/月を「可視化どまり」から「実際に送信抑止」へ（on_exceed をプラン由来にする）
-- 設計正本: docs/spec/AI_SECRETARY_STAGE4_SHARED_BOT_TENANCY.md §3 /
--   src/lib/channels/metering/decideAutoPush.ts（真理値表 on_exceed × state）
-- 運用: docs/ops/SHARED_LINE_BUDGET_RUNBOOK.md
--
-- 背景: 20260720201858 は monthly_push_quota を同期し、メータリングcronが free=50 で state='hard'
--   にするところまでは効いていた。しかし on_exceed は既定 'none' のままで、decideAutoPush の
--   真理値表上 none は state に関係なく常に送信 = **50は可視化どまりで送信は止まっていなかった**。
--   （抑止していたのはグローバル200通/account層だけ = 共有bot全org合算でしか止まらない。）
--
-- 本migration: on_exceed を **プラン由来** にする。従量あり(free/不明plan = quota=50)は 'block'、
--   無制限(paid = quota NULL)は 'none'。これで free org は 50 到達(state='hard')で auto-push が
--   抑止される（block×hard→SUPPRESS）。対話的push(webへの直接応答)・console手動送信は送信境界を
--   通らないため引き続き維持される（顧客体験は切らない・止まるのは digest/リマインド等の auto-push のみ）。
--
-- 設計判断: これにより on_exceed は「当社が手で設定する per-org ノブ」ではなく **プラン由来で自動決定**
--   になる（free=block / paid=none）。現状 on_exceed を手動設定している org は存在しないため実害なし。
--   将来 org 個別に degrade 等へ寄せたくなったらこの方針を再検討する。
-- =============================================================================

-- トリガー本体を差し替え: quota に加えて on_exceed も同期する。
-- monthly_push_quota / on_exceed 以外の列(allow_code_only / shared_bot_access / state)は触らない。
create or replace function public.app_sync_org_channel_push_quota() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quota int := public.app_org_push_quota(NEW.plan_id, NEW.status, NEW.current_period_end);
  -- 従量あり(quota非NULL=free/不明)は block、無制限(NULL=paid)は none。
  v_on_exceed text := case when v_quota is null then 'none' else 'block' end;
begin
  insert into public.org_channel_policy (org_id, monthly_push_quota, on_exceed)
  values (NEW.org_id, v_quota, v_on_exceed)
  on conflict (org_id) do update
    set monthly_push_quota = excluded.monthly_push_quota,
        on_exceed = excluded.on_exceed,
        updated_at = now();
  return NEW;
end;
$$;

revoke all on function public.app_sync_org_channel_push_quota() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- backfill: 既存 org_channel_policy 行の on_exceed を現在の quota から一度そろえる
--   （トリガーは今後の org_billing 書込にしか効かないため）。
--   quota=50(free) → 'block' / quota NULL(paid) → 'none'。
-- -----------------------------------------------------------------------------
update public.org_channel_policy p
set on_exceed = case when p.monthly_push_quota is null then 'none' else 'block' end,
    updated_at = now()
where p.on_exceed is distinct from (case when p.monthly_push_quota is null then 'none' else 'block' end);

-- -----------------------------------------------------------------------------
-- 日次フル再同期関数も on_exceed を同期するよう差し替える（20260720205553 の穴埋め）。
-- 旧版は monthly_push_quota しか直さないため、past_due猶予切れ等の drift 補正で quota=50 に
-- 戻っても on_exceed が 'none' のまま取り残され、可視化どまりの穴が再発する。quota と on_exceed の
-- どちらかがズレていれば upsert する（冪等・変化なしは触らない）。
-- -----------------------------------------------------------------------------
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
  insert into public.org_channel_policy (org_id, monthly_push_quota, on_exceed)
  select org_id, q, case when q is null then 'none' else 'block' end from desired
  on conflict (org_id) do update
    set monthly_push_quota = excluded.monthly_push_quota,
        on_exceed = excluded.on_exceed,
        updated_at = now()
    where public.org_channel_policy.monthly_push_quota is distinct from excluded.monthly_push_quota
       or public.org_channel_policy.on_exceed is distinct from excluded.on_exceed;
  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

revoke all on function public.app_resync_all_org_push_quota() from public, anon, authenticated;

-- =============================================================================
-- 検証（run_org_push_quota_sync.sh に on_exceed 検証を追記）:
--   backfill 後: free(quota=50)→on_exceed='block' / paid(quota NULL)→'none'。
--   trigger: insert free→'block' / upgrade pro→'none' / downgrade free→'block' / canceled→'block' /
--            past_due猶予内→'none' / 猶予切れ→'block' / 不明plan→'block'。
-- ロールバック:
--   -- 旧トリガー関数(on_exceed を触らない版)へ戻す:
--   -- 20260720201858 の app_sync_org_channel_push_quota 定義を再適用し、
--   -- 必要なら update org_channel_policy set on_exceed='none'; で観測のみへ戻す。
-- =============================================================================
