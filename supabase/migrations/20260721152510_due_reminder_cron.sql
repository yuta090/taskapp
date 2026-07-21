-- =============================================================================
-- AI秘書 Stage 5 期限リマインド — PR-1（pg_cron 起動配線）
-- =============================================================================
-- 20260721133427_due_reminder_pr0.sql で土台(正本境界列 / task_due_reminder_occurrences /
-- claim・finalize RPC / _enqueue_connector_job)を入れた。本migrationはその planner/sender を
-- pg_cron から周期起動するだけ(DDL/RPC/トリガーには一切触れない)。
--
-- 方式は 20260720180744_connector_cron.sql の app_invoke_connector /
-- 20260718092110_google_tasks_mirror.sql の app_invoke_task_mirror と完全に同型:
--   vault に登録した URL/secret を net.http_post で内部 cron API に POST する。
--
-- 2種のジョブ:
--   - due-reminder-planner (0 * * * *)  毎時 : 期限から occurrence を材料化(plan)する。
--   - due-reminder-sender  (*/5 * * * *) 5分毎: 到来済み occurrence を claim して配信する。
--
-- 必要な vault シークレット(本番運用で別途登録。未設定なら warning を出して no-op):
--   - cron_due_reminder_planner_url : planner の内部API URL
--       例) https://<app>/api/cron/due-reminder-planner
--   - cron_due_reminder_sender_url  : sender の内部API URL
--       例) https://<app>/api/cron/due-reminder-sender
--   - cron_secret                   : 既存の共有シークレット(他 cron と共用)。
-- TS route 側の認証: 本関数は Authorization: Bearer <cron_secret> を付けて POST する。
--   route 実装(別担当)は環境変数 CRON_SECRET と突合して認可すること
--   (/api/cron/due-reminder-planner・/api/cron/due-reminder-sender)。
--
-- 適用: アプリ稼働中に本番共用DBへ適用可(新規関数＋cron登録のみ・既存を壊さない)。
--   PR-0 のオブジェクトには依存しない(URL 先の route が PR-0 の RPC を叩くだけで、
--   本 migration 自体は route/RPC の存在に依存しない)。適用順序の制約なし。
-- ロールバック: drop function public.app_invoke_due_reminder(text);
--   および cron.unschedule('due-reminder-planner') / cron.unschedule('due-reminder-sender')。
--   いずれも可逆(新規追加のみ・不可逆な変更なし)。
-- =============================================================================

create or replace function public.app_invoke_due_reminder(p_kind text)
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
    where name = 'cron_due_reminder_' || p_kind || '_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  if v_url is null or v_secret is null then
    raise warning 'due reminder(%): vault secrets 未設定', p_kind;
    return;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
    body := '{}'::jsonb
  );
end;
$$;

revoke all on function public.app_invoke_due_reminder(text) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- planner は毎時(期限は日単位。occurrence の材料化は毎時で十分)
    if not exists (select 1 from cron.job where jobname = 'due-reminder-planner') then
      perform cron.schedule('due-reminder-planner', '0 * * * *', $cron$select app_invoke_due_reminder('planner')$cron$);
    end if;
    -- sender は5分毎(到来済み occurrence を細かく拾って配信。mirror-dispatch と同ペース)
    if not exists (select 1 from cron.job where jobname = 'due-reminder-sender') then
      perform cron.schedule('due-reminder-sender', '*/5 * * * *', $cron$select app_invoke_due_reminder('sender')$cron$);
    end if;
  end if;
end $$;
