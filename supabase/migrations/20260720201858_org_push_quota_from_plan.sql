-- =============================================================================
-- AI秘書 Stage 4: 共通LINE org別クォータ(monthly_push_quota)をプランから同期する
-- 設計正本: docs/spec/AI_SECRETARY_STAGE4_SHARED_BOT_TENANCY.md §3 /
--   src/lib/billing/entitlements.ts（PLAN_LIMITS.monthlySharedPushQuota / resolvePlanFromBilling）
-- 運用: docs/ops/SHARED_LINE_BUDGET_RUNBOOK.md
--
-- 背景（塞ぐギャップ）: org_channel_policy.monthly_push_quota はこれまで誰も書いておらず、
--   常に NULL(無制限)だった。そのため org 層メタリング cron は全 org を素通しし
--   （where monthly_push_quota is not null でスキップ）、無料 org の 50通/月 上限が一切効いて
--   いなかった。entitlements.ts のコメントが約束していた「service role が同期する」を実装する。
--
-- 方式: org_billing への書込（rpc_create_org_with_billing の新規作成・stripe webhook・reconcile が
--   すべてここを通る）に AFTER トリガーを掛け、効果的プランから quota を org_channel_policy へ upsert。
--   これで「新規無料org作成」「アップグレード(→NULL)」「ダウングレード/解約(→50)」の全経路を
--   1箇所で捕捉する（5つの書込サイトに個別実装して取りこぼす事故を避ける）。過去分は末尾で backfill。
--
--   quota の consumer は org 層メタリング cron のみ。NULL(無制限)にすると cron が state を 'ok' に
--   戻す（アップグレードで縮退解除）。50 にすると 80%=40 で soft、50 で hard。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 効果的プラン → 共通LINE org別クォータ。resolvePlanFromBilling(entitlements.ts) と同値に保つ:
--   plan が pro/enterprise かつ 支払い有効(active/trialing、または past_due の14日猶予内)なら
--   無制限(NULL)。それ以外(free / 不明plan / canceled / 猶予切れ past_due)は free クォータ。
-- past_due の猶予判定に now() を使うため stable。
-- -----------------------------------------------------------------------------
create or replace function public.app_org_push_quota(
  p_plan_id text,
  p_status text,
  p_current_period_end timestamptz
) returns int
language plpgsql
stable
set search_path = public
as $$
declare
  -- FREE_SHARED_PUSH_QUOTA=50 : PLAN_LIMITS.free.monthlySharedPushQuota(src/lib/billing/entitlements.ts)
  --   と必ず一致させる（org_push_quota_parity.test.ts が両者の一致を回帰で固定する）。
  c_free_quota constant int := 50;
  c_grace constant interval := interval '14 days';
  v_paid boolean;
begin
  -- free / 不明plan は fail-closed で free 扱い（無制限にしない）。
  if p_plan_id is null or p_plan_id not in ('pro', 'enterprise') then
    return c_free_quota;
  end if;

  v_paid := case
    when p_status in ('active', 'trialing') then true
    when p_status = 'past_due'
      and p_current_period_end is not null
      and now() <= p_current_period_end + c_grace then true
    else false
  end;

  return case when v_paid then null else c_free_quota end;
end;
$$;

revoke all on function public.app_org_push_quota(text, text, timestamptz) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- トリガー本体: org_billing の行から quota を算出し org_channel_policy へ upsert。
-- monthly_push_quota 以外の列(allow_code_only / on_exceed / state)は触らない。
-- -----------------------------------------------------------------------------
create or replace function public.app_sync_org_channel_push_quota() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.org_channel_policy (org_id, monthly_push_quota)
  values (NEW.org_id, public.app_org_push_quota(NEW.plan_id, NEW.status, NEW.current_period_end))
  on conflict (org_id) do update
    set monthly_push_quota = excluded.monthly_push_quota,
        updated_at = now();
  return NEW;
end;
$$;

revoke all on function public.app_sync_org_channel_push_quota() from public, anon, authenticated;

drop trigger if exists trg_org_billing_sync_push_quota on public.org_billing;
create trigger trg_org_billing_sync_push_quota
  after insert or update of plan_id, status, current_period_end on public.org_billing
  for each row execute function public.app_sync_org_channel_push_quota();

-- -----------------------------------------------------------------------------
-- backfill: 既存 org は org_billing の現状から一度同期する（トリガーは今後の書込にしか効かないため）。
-- -----------------------------------------------------------------------------
insert into public.org_channel_policy (org_id, monthly_push_quota)
select b.org_id, public.app_org_push_quota(b.plan_id, b.status, b.current_period_end)
from public.org_billing b
on conflict (org_id) do update
  set monthly_push_quota = excluded.monthly_push_quota,
      updated_at = now();

-- =============================================================================
-- 検証（run_org_push_quota_sync.sh）:
--   1) 新規 org_billing INSERT(free/active) で org_channel_policy.monthly_push_quota=50 が付く。
--   2) plan_id を pro/active に UPDATE すると NULL(無制限) になる（アップグレードで縮退解除）。
--   3) plan_id=free へ戻す/解約(canceled) で 50 に戻る。
--   4) past_due は current_period_end+14日 の内側なら NULL(プラン維持)、外側なら 50。
--   5) 不明 plan_id は fail-closed で 50。
--   6) 適用時 backfill で既存行に quota が付く。
--   7) allow_code_only 等の既存列は上書きされない。
-- ロールバック:
--   drop trigger if exists trg_org_billing_sync_push_quota on public.org_billing;
--   drop function if exists public.app_sync_org_channel_push_quota();
--   drop function if exists public.app_org_push_quota(text, text, timestamptz);
-- =============================================================================
