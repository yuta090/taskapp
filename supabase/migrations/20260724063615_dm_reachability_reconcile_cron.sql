-- =============================================================================
-- DM 到達不能の日次照合（回収）— pg_cron 起動配線
-- 設計正本: docs/spec/AI_SECRETARY_STAGE5_DUE_REMINDERS.md §9.1 の残余リスク(a)(b)
--
-- 背景（既存の穴塞ぎでは拾えない2ケースを回収する）:
--   20260722181111_channel_user_link_dm_unreachable.sql で channel_user_links.dm_unreachable_at を
--   足し、LINE webhook の unfollow(mark)/follow(clear) で「Bot をブロックされた人」を拾えるように
--   した。ただし webhook 単独トリガでは次の2つを永久に拾えない:
--     (b) 本列導入前から既にブロック済みのユーザー（過去に unfollow を送っていない）。
--     (a) 一過性 DB 障害等で unfollow の書き込みを取りこぼしたユーザー（LINE は unfollow を再送しない）。
--   これらを LINE の GET /v2/bot/profile/{userId}（ブロック済み/未友だちで 404 を返す）で
--   active な DM link を日次照合し、404 → mark / 200 → clear を突き合わせて回収する。
--
-- 本 migration の範囲: 回収ジョブを pg_cron から周期起動する配線のみ（新規関数＋cron登録）。
--   実照合ロジック（LINE profile API 呼び出し・mark/clear の突き合わせ）は TS route
--   /api/cron/dm-reachability-reconcile 側（別担当）が実装する。本 migration は route/RPC/DDL には
--   一切触れない（URL 先の route が既存 RPC を叩くだけで、本 migration は route の存在に依存しない）。
--
-- 方式は 20260721152510_due_reminder_cron.sql の app_invoke_due_reminder /
-- 20260721200902_task_sync_cron.sql と完全に同型:
--   vault に登録した URL/secret を net.http_post で内部 cron API に POST する。
--
-- ジョブ: dm-reachability-reconcile … 1日1回（'30 15 * * *' = UTC 15:30 = JST 翌 0:30）。
--   深夜帯かつ他 cron（due-reminder-planner '0 * * * *' / sender '*/5 * * * *' /
--   task-sync-import '*/15 * * * *'）と分秒をずらして相乗り負荷を避ける。
--
-- ⚠ LINE profile API のレート制限に留意:
--   GET /v2/bot/profile/{userId} は active link 1件につき1回叩く（アカウント単位のレート上限あり）。
--   本 cron は「日次で1回だけ起動する」役割に徹し、実際のスロットリング（呼び出し間隔・
--   1回あたりの処理件数上限・バックオフ）は route 側（別担当）で行うこと。スケジューラ側で
--   件数を散らさない（ツール固有のレート事実は route に閉じる）。
--
-- 必要な vault シークレット（本番運用で別途登録。未設定なら warning を出して no-op）:
--   - cron_dm_reachability_reconcile_url : 回収 route の内部API URL
--       値) https://agentpm.app/api/cron/dm-reachability-reconcile
--   - cron_secret                        : 既存の共有シークレット（他 cron と共用・追加登録不要）。
-- TS route 側の認証: 本関数は Authorization: Bearer <cron_secret> を付けて POST する。
--   route 実装（別担当）は環境変数 CRON_SECRET と突合して認可すること。
--
-- 適用: アプリ稼働中に本番共用DBへ適用可（新規関数＋cron登録のみ・既存を壊さない）。
--   pg_cron 不在の環境ではガードで cron 登録を skip する。冪等再適用OK。破壊的変更なし。
-- ロールバック: drop function public.app_invoke_dm_reachability_reconcile();
--   および cron.unschedule('dm-reachability-reconcile')。いずれも可逆（新規追加のみ）。
-- =============================================================================

create or replace function public.app_invoke_dm_reachability_reconcile()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets
    where name = 'cron_dm_reachability_reconcile_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  if v_url is null or v_secret is null then
    raise warning 'dm reachability reconcile: vault secrets 未設定';
    return;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
    body := '{}'::jsonb
  );
end;
$$;

revoke all on function public.app_invoke_dm_reachability_reconcile() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- 回収は1日1回で十分（既にブロック済み/取りこぼしの吸収が目的。即時性は不要）。
    -- '30 15 * * *' = UTC 15:30 = JST 翌 0:30。他 cron と分秒をずらす。
    if not exists (select 1 from cron.job where jobname = 'dm-reachability-reconcile') then
      perform cron.schedule('dm-reachability-reconcile', '30 15 * * *', $cron$select app_invoke_dm_reachability_reconcile()$cron$);
    end if;
  end if;
end $$;
