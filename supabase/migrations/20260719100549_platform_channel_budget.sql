-- =============================================================================
-- AI秘書 Stage 4 共有bot(共通LINE)グローバル予算層(1/2): platform_channel_budget
-- 設計正本: docs/spec/AI_SECRETARY_STAGE4_SHARED_BOT_TENANCY.md §3(使用量メータリング骨格)
--   既知フォローアップ #2「account軸(200/account)の相乗り監視/アラート」（fable確定設計）
--
-- LINE無料枠(200通/月)は「LINEアカウント単位（＝共有bot全org相乗り）」であり org単位ではない。
-- 既存 org_channel_policy（org別cap）だけでは持ち出しが非有界なため、account軸のグローバル予算層を
-- 追加する。使用量メータリングと同じ規約: 真実の源 = channel_messages から都度導出する
-- （独立記録経路は作らない。本表は「予算枠(budget)と現在state」だけを持つ器）。
--
-- platform専用（owner_type='platform'＝当社所有の共有bot）。owner_type='org'（顧客専用bot）は
-- 顧客側の枠であり当社の持ち出しではないため、この予算層の対象外（トリガーで作成自体を拒否する）。
--
-- ★書込は service role のみ（RLS有効・ポリシー無し＝authenticated/anonは一切不可）。
-- =============================================================================

create table if not exists public.platform_channel_budget (
  account_id uuid primary key references public.channel_accounts(id) on delete cascade,
  -- 月間 push 予算（当社原価の物理上限の目安）。既定200＝LINE無料枠1accountぶん。
  monthly_push_budget int not null default 200 check (monthly_push_budget >= 0),
  -- cron(app_refresh_platform_budget_state)が集計で更新する現在の縮退状態。
  state text not null default 'ok' check (state in ('ok', 'soft', 'hard')),
  updated_at timestamptz not null default now()
);

comment on table public.platform_channel_budget is
  '共有bot(owner_type=platform)のaccount軸グローバル予算(実物理上限)。org別capとは別レイヤー(二層制)。使用実績は保存せずchannel_messagesから都度導出。書込はservice roleのみ';
comment on column public.platform_channel_budget.monthly_push_budget is
  '月間push予算（既定200=LINE無料枠1accountぶん）。当社原価の物理上限の目安であり顧客のquotaではない';
comment on column public.platform_channel_budget.state is
  'cron が (account_id, 月) 集計で更新: ok / soft(縮退) / hard(停止)。送信境界(decideSharedSendBudget)のglobal層のみが読んで分岐';

-- -----------------------------------------------------------------------------
-- platform 限定ガード: owner_type<>'platform' のaccountに対する行は作れない/移せない。
-- 専用bot(owner_type='org')は顧客側の枠であり、当社が守るべき物理上限の対象ではないため。
-- -----------------------------------------------------------------------------
create or replace function public.platform_channel_budget_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner_type text;
begin
  select owner_type into v_owner_type
  from public.channel_accounts
  where id = new.account_id;

  if v_owner_type is distinct from 'platform' then
    raise exception 'platform_channel_budget: account_id % is not owner_type=platform (got %)', new.account_id, v_owner_type;
  end if;

  return new;
end;
$$;

revoke all on function public.platform_channel_budget_guard() from public, anon, authenticated;

drop trigger if exists trg_platform_channel_budget_guard on public.platform_channel_budget;
create trigger trg_platform_channel_budget_guard
  before insert or update on public.platform_channel_budget
  for each row execute function public.platform_channel_budget_guard();

-- -----------------------------------------------------------------------------
-- RLS: service role専用（読取も書込もポリシー無し）。org横断のグローバル予算は
-- 特定orgの内部メンバーに見せる情報ではない（org_channel_policyとは異なりauthenticated selectも許可しない）。
-- -----------------------------------------------------------------------------
alter table public.platform_channel_budget enable row level security;
revoke all on table public.platform_channel_budget from anon, authenticated;

-- -----------------------------------------------------------------------------
-- account軸の月次集計を軽くする部分インデックス。
--   where billable_push and account_id = $1 and occurred_at >= $from and occurred_at < $to
-- 既存 channel_messages_billable_push_usage は (org_id, occurred_at, account_id) 先頭が org_id の
-- ため account 軸横断集計（org_idフィルタ無し）には不向き。account_id 先頭で新設する。
-- -----------------------------------------------------------------------------
create index if not exists channel_messages_billable_push_account_usage
  on public.channel_messages (account_id, occurred_at)
  where billable_push;

-- =============================================================================
-- 検証（適用後・service role）:
--   1) owner_type='platform' のaccountへのINSERTが成功すること。
--   2) owner_type='org' のaccountへのINSERTがトリガーで拒否されること。
--   3) authenticated が select/insert/update いずれも不可であること（RLS・grant無し）。
--   4) channel_messages_billable_push_account_usage が billable_push=true 行のみを含むこと。
-- ロールバック:
--   drop index if exists public.channel_messages_billable_push_account_usage;
--   drop trigger if exists trg_platform_channel_budget_guard on public.platform_channel_budget;
--   drop function if exists public.platform_channel_budget_guard();
--   drop table if exists public.platform_channel_budget;
-- =============================================================================
