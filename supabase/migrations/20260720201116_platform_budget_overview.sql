-- =============================================================================
-- AI秘書 Stage 4 共有bot(共通LINE)グローバル予算層: 運用者向け可視化関数
-- 設計正本: docs/spec/AI_SECRETARY_STAGE4_SHARED_BOT_TENANCY.md §3
--   既知フォローアップ #2「account軸の相乗り監視・執行は未実装」— 監視(可視化)側をここで足す。
--   運用手順: docs/ops/SHARED_LINE_BUDGET_RUNBOOK.md
--
-- 背景: 共通LINEの無料枠は 200通/月・LINEアカウント(=platform account)単位で全org相乗り。
-- app_refresh_platform_budget_state() が state(ok/soft/hard)を立て、送信境界(decideSharedSendBudget
-- の global 層)が読んで抑止する。しかし運用者が「今 account ごとに何通使い・残りいくつ・どの state か」
-- を一目で見る手段が無かった（残量が見えないまま hard に張り付く事故が起きうる）。
--
-- この関数は platform account ごとに budget / 当月使用 / 残量 / soft閾値 / state を返す純SELECT。
-- 集計式は app_refresh_platform_budget_state() と同一（billable_push・status='sent'・当月JST・
-- org_idフィルタ無しで全org相乗り合算）にして、cronが立てる state と数字がズレないようにする。
-- security definer + authenticated への grant 無し＝service role / SQLコンソール専用（横断集計を
-- 一般ユーザーに晒さない）。資格情報(credentials_encrypted)は一切返さない。
-- =============================================================================

create or replace function public.app_platform_budget_overview()
returns table (
  account_id uuid,
  display_name text,
  monthly_push_budget int,
  used_current_month bigint,
  remaining int,
  soft_threshold int,
  state text,
  updated_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select
    b.account_id,
    a.display_name,
    b.monthly_push_budget,
    coalesce(u.cnt, 0) as used_current_month,
    greatest(b.monthly_push_budget - coalesce(u.cnt, 0), 0)::int as remaining,
    ceil(b.monthly_push_budget * 0.8)::int as soft_threshold,
    b.state,
    b.updated_at
  from public.platform_channel_budget b
  join public.channel_accounts a on a.id = b.account_id
  cross join lateral (
    select month_from, month_to from public.app_jst_current_month_bounds()
  ) mb
  left join lateral (
    select count(*) as cnt
    from public.channel_messages m
    where m.billable_push
      and m.status = 'sent'
      and m.account_id = b.account_id
      and m.occurred_at >= mb.month_from
      and m.occurred_at < mb.month_to
  ) u on true
  order by remaining asc;   -- 残量が少ない(危険な)account を先頭に
$$;

revoke all on function public.app_platform_budget_overview() from public, anon, authenticated;

-- =============================================================================
-- 使い方（service role / SQLコンソール）:
--   select * from public.app_platform_budget_overview();
--     → remaining 昇順。remaining が 0 近い account が持ち出しリスク。state=soft は隔日縮退中、
--       state=hard は全org相乗りの当月上限に到達し送信抑止中。
-- 緊急ブレーキ（手動で即時に共通LINE auto-push を止める）:
--   update public.platform_channel_budget set state='hard', updated_at=now() where account_id='<id>';
--     → 既存グループは切らない（decideSharedSendBudget が global=hard で auto-push のみ抑止）。
--   解除は state='ok' に戻すか、次回 cron(app_refresh_platform_budget_state)の再計算に任せる。
-- 検証:
--   1) platform account ごとに1行返り、used_current_month が cron の集計と一致すること。
--   2) remaining = max(budget - used, 0)、soft_threshold = ceil(budget*0.8) であること。
--   3) authenticated ロールでは実行できないこと（service role 専用）。
-- ロールバック:
--   drop function if exists public.app_platform_budget_overview();
-- =============================================================================
