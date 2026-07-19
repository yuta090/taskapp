-- =============================================================================
-- AI秘書 Stage 4 共有bot(共通LINE)グローバル予算層(2/2): (account_id, 月) 集計 → state 更新 cron
-- 設計正本: docs/spec/AI_SECRETARY_STAGE4_SHARED_BOT_TENANCY.md §3(使用量メータリング骨格)
--   既知フォローアップ #2「account軸の相乗り監視・執行は未実装」（fable確定設計）
--
-- 集計は純SQL（既存 app_refresh_channel_metering_state と同型）。org_id フィルタを一切
-- 掛けない＝共有bot配下の全org相乗り分を合算する（LINE無料枠はaccount単位のため）。
-- 執行（送信境界での抑止・縮退）はアプリ層（decideSharedSendBudget の global 層）が
-- ここで立てた state を読んで行う。ここでは「状態を立てる」だけ。
-- =============================================================================

create or replace function public.app_refresh_platform_budget_state()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from timestamptz;
  v_to timestamptz;
  v_cnt bigint;
  v_new text;
  v_updated integer := 0;
  r record;
begin
  -- 自動プロビジョニング: owner_type='platform' の account には既定予算(200)で必ず行を持たせる。
  -- 既に行がある account はそのまま（monthly_push_budget を後から個別調整していても上書きしない）。
  insert into public.platform_channel_budget (account_id)
  select id from public.channel_accounts where owner_type = 'platform'
  on conflict (account_id) do nothing;

  select month_from, month_to into v_from, v_to from public.app_jst_current_month_bounds();

  for r in
    select account_id, monthly_push_budget
    from public.platform_channel_budget
  loop
    -- account軸の全org横断合算。org_idフィルタを一切掛けない（org_idがNULLの行があっても合算対象）。
    select count(*) into v_cnt
      from public.channel_messages m
      where m.billable_push
        and m.status = 'sent'
        and m.account_id = r.account_id
        and m.occurred_at >= v_from
        and m.occurred_at < v_to;

    v_new := case
      when v_cnt >= r.monthly_push_budget then 'hard'
      when v_cnt >= ceil(r.monthly_push_budget * 0.8) then 'soft'
      else 'ok'
    end;

    update public.platform_channel_budget
      set state = v_new, updated_at = now()
      where account_id = r.account_id and state is distinct from v_new;
    if found then
      v_updated := v_updated + 1;
    end if;
  end loop;

  return v_updated;
end;
$$;

revoke all on function public.app_refresh_platform_budget_state() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- スケジュール登録: 毎時5分（pg_cronがある環境のみ）。既存 channel-metering-state（毎時0分・
-- org層）と実行時刻を分散させ、同時起動による競合/負荷集中を避ける。
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from cron.job where jobname = 'platform-budget-state') then
      perform cron.schedule(
        'platform-budget-state',
        '5 * * * *',
        'select public.app_refresh_platform_budget_state()'
      );
    end if;
  end if;
end $$;

-- =============================================================================
-- 検証（適用後・service role）:
--   1) owner_type='platform' の account が platform_channel_budget に自動プロビジョニングされること
--      （owner_type='org' には行が作られないこと）。
--   2) 同一 account に orgA=150件, orgB=60件 の billable_push(sent) があれば計210 >= 200 → hard。
--      org_id フィルタが掛かっていないことの確認（合算されること）。
--   3) queued/failed の billable_push 行はカウントされないこと（sent のみ）。
--   4) budget=200 のとき 159件→ok / 160件→soft(ceil(200*0.8)=160) / 200件→hard の境界。
--   5) 前月分の billable_push は当月集計に含まれないこと（月初リセット）。
--   6) platform_channel_budget への直接 INSERT で owner_type='org' の account_id を指定すると
--      トリガー(platform_channel_budget_guard)で拒否されること。
-- ロールバック:
--   select cron.unschedule('platform-budget-state');  -- pg_cron 環境のみ
--   drop function if exists public.app_refresh_platform_budget_state();
-- =============================================================================
