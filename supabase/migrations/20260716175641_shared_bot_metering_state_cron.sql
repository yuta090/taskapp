-- =============================================================================
-- AI秘書 Stage 4 PR4 メータリング(2/2): (org_id, account_id, 月) 集計 → state 更新 cron
-- 設計正本: docs/spec/AI_SECRETARY_STAGE4_SHARED_BOT_TENANCY.md §3(使用量メータリング骨格) / §6-4b / §7-10
--
-- 集計は純SQL（外部呼び出し無し＝channel-digest 等と違い HTTP ルート不要）。pg_cron が
-- security definer 関数を定期起動し、org ごとの当月 billable push 数を monthly_push_quota と
-- 突き合わせて org_channel_policy.state を ok/soft/hard に更新する。
--
-- 執行（送信境界での抑止・縮退）はアプリ層（digest/approval-notify cron）が state を読んで行う。
-- ここでは「状態を立てる」だけ。inbound 記録・webhook 200・証跡は一切触らない（設計正本 §3）。
--
-- soft 閾値 = quota の 80%（ceil）。段数/閾値は後から変更可（設計正本 §7 後半）。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- JST 当月境界 [from, to) を timestamptz で返す（本番Vercel/DBのUTC既定に依存しない）。
-- -----------------------------------------------------------------------------
create or replace function public.app_jst_current_month_bounds(
  out month_from timestamptz,
  out month_to timestamptz
)
language sql
stable
set search_path = public
as $$
  select
    (date_trunc('month', (now() at time zone 'Asia/Tokyo'))) at time zone 'Asia/Tokyo',
    (date_trunc('month', (now() at time zone 'Asia/Tokyo')) + interval '1 month') at time zone 'Asia/Tokyo'
$$;

-- -----------------------------------------------------------------------------
-- 当月 (JST) の org 単位 billable push 数。console 表示用（自org のみ・内部メンバー）。
--   ※ account 軸の内訳が要るときは別途集計。ここは送信境界の enforcement と同じ「org 総数」。
-- -----------------------------------------------------------------------------
create or replace function public.app_org_channel_push_usage_current_month(p_org uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_from timestamptz;
  v_to timestamptz;
  v_cnt bigint;
begin
  if not public.app_is_org_internal(p_org) then
    raise exception 'app_org_channel_push_usage_current_month: forbidden' using errcode = '42501';
  end if;
  select month_from, month_to into v_from, v_to from public.app_jst_current_month_bounds();
  select count(*) into v_cnt
    from public.channel_messages m
    where m.billable_push
      and m.org_id = p_org
      and m.occurred_at >= v_from
      and m.occurred_at < v_to;
  return v_cnt;
end;
$$;

revoke all on function public.app_org_channel_push_usage_current_month(uuid) from public, anon;
grant execute on function public.app_org_channel_push_usage_current_month(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- state 更新本体（service role / cron 専用）。monthly_push_quota が非NULLの org のみ判定し、
-- NULL（無制限）は state を既定 'ok' に正規化する。行の無い org は暗黙 ok/none（送信境界が coalesce）。
-- -----------------------------------------------------------------------------
create or replace function public.app_refresh_channel_metering_state()
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
  select month_from, month_to into v_from, v_to from public.app_jst_current_month_bounds();

  for r in
    select org_id, monthly_push_quota
    from public.org_channel_policy
    where monthly_push_quota is not null
  loop
    select count(*) into v_cnt
      from public.channel_messages m
      where m.billable_push
        and m.org_id = r.org_id
        and m.occurred_at >= v_from
        and m.occurred_at < v_to;

    v_new := case
      when v_cnt >= r.monthly_push_quota then 'hard'
      when v_cnt >= ceil(r.monthly_push_quota * 0.8) then 'soft'
      else 'ok'
    end;

    update public.org_channel_policy
      set state = v_new, updated_at = now()
      where org_id = r.org_id and state is distinct from v_new;
    if found then
      v_updated := v_updated + 1;
    end if;
  end loop;

  -- 無制限（quota NULL）の org は state を既定 'ok' に戻す（quota を後から外した場合の追従）。
  update public.org_channel_policy
    set state = 'ok', updated_at = now()
    where monthly_push_quota is null and state is distinct from 'ok';
  get diagnostics v_cnt = row_count;
  v_updated := v_updated + v_cnt;

  return v_updated;
end;
$$;

revoke all on function public.app_refresh_channel_metering_state() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- スケジュール登録: 毎時0分（pg_cronがある環境のみ）。集計は安価（部分インデックス）。
--   送信境界は cron が立てた state を読むだけなので、粒度は1時間で十分。
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from cron.job where jobname = 'channel-metering-state') then
      perform cron.schedule(
        'channel-metering-state',
        '0 * * * *',
        'select public.app_refresh_channel_metering_state()'
      );
    end if;
  end if;
end $$;

-- =============================================================================
-- 検証（適用後・service role）:
--   1) quota=10 の org で当月 billable_push を 8 行入れ app_refresh_channel_metering_state()
--      → state='soft'（8 >= ceil(10*0.8)=8）。10 行で 'hard'。7 行で 'ok'。
--   2) monthly_push_quota=NULL の org は常に 'ok' に正規化されること。
--   3) 行の無い org は更新対象外（暗黙 ok/none）であること。
--   4) app_org_channel_push_usage_current_month は他org呼び出しで 42501 を返すこと。
-- ロールバック:
--   select cron.unschedule('channel-metering-state');  -- pg_cron 環境のみ
--   drop function if exists public.app_refresh_channel_metering_state();
--   drop function if exists public.app_org_channel_push_usage_current_month(uuid);
--   drop function if exists public.app_jst_current_month_bounds();
-- =============================================================================
