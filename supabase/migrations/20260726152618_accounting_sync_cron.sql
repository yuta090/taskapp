-- =============================================================================
-- 見積書・請求書の状態取り込み — pg_cron 起動配線
--
-- 目的: 発行した請求書が入金されたかどうかを、TaskApp 側だけで把握できるようにする。
--   これが回らないと「請求書を出した」で記録が止まり、入金の確認は会計ソフトを
--   個別に見に行くしかない。
--
-- ⚠ 対象は **見積書・請求書の状態だけ**。仕訳・入出金明細・決算といった会計データは
--   一切取得しない（src/lib/accounting/ 全体の約束と対）。
--
-- 方式は 20260724063615_dm_reachability_reconcile_cron.sql と完全に同型:
--   vault に登録した URL/secret を net.http_post で内部 cron API に POST する。
--
-- ジョブ: accounting-sync … '17 */2 * * *'（2時間おき・毎時17分）。
--   入金の反映は分単位の即時性を要さない一方、月末の入金確認では当日中に見えてほしい。
--   分を 17 にずらすのは、毎時0分に集中している他 cron（due-reminder-planner '0 * * * *'）
--   との相乗り負荷を避けるため。
--
-- ⚠ 外部APIのレート制限は route 側で吸収する:
--   1回の実行で見るのは未確定の書類だけ・最大50件（src/lib/accounting/sync.ts の BATCH_SIZE）。
--   同じ書類を30分以内に引き直さない下限も route 側に持つ。スケジューラ側では件数を散らさない
--   （ツール固有のレート事実は route に閉じる）。
--
-- 必要な vault シークレット（本番運用で別途登録。未設定なら warning を出して no-op）:
--   - cron_accounting_sync_url : https://agentpm.app/api/cron/accounting-sync
--   - cron_secret              : 既存の共有シークレット（他 cron と共用・追加登録不要）
--
-- 適用: アプリ稼働中に本番共用DBへ適用可（新規関数＋cron登録のみ）。冪等再適用OK。
--   pg_cron 不在の環境ではガードで cron 登録を skip する。破壊的変更なし。
-- ロールバック: drop function public.app_invoke_accounting_sync();
--   および cron.unschedule('accounting-sync')。いずれも可逆（新規追加のみ）。
-- =============================================================================

create or replace function public.app_invoke_accounting_sync()
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
    where name = 'cron_accounting_sync_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  if v_url is null or v_secret is null then
    raise warning 'accounting sync: vault secrets 未設定';
    return;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
    body := '{}'::jsonb
  );
end;
$$;

revoke all on function public.app_invoke_accounting_sync() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from cron.job where jobname = 'accounting-sync') then
      perform cron.schedule('accounting-sync', '17 */2 * * *', $cron$select app_invoke_accounting_sync()$cron$);
    end if;
  end if;
end $$;
