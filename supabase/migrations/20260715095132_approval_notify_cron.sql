-- =============================================================================
-- Stage 2.7-B §4-4: 承認確認ディスパッチャの定期起動（pg_cron → pg_net）
--
-- pending 承認候補（夜間ingest / 即時メンションの送信失敗分）を責任者の 1:1 へ送る
-- /api/cron/approval-notify を定期起動する。cron(RPC内)から直接LINE送信できないため、
-- 既存 channel-digest と同じく pg_net でアプリの HTTP エンドポイントを叩く。
--
-- 即時メンション経路は webhook がその場で 1:1 を送る（§4-5）。このcronは
--   (a) 夜間ingestで作られた pending の朝の配信
--   (b) 即時送信できなかった分（責任者未リンク・送信失敗）のリトライ
-- を担うフォールバック。空振り時は claim RPC が0件を返すだけで副作用なし。
-- =============================================================================

-- cron_secret は client-reminders / channel-digest と共有（既にVault登録済みなら再登録不要）。
-- URL だけ環境ごとに1回登録する:
--   select vault.create_secret('https://agentpm.app/api/cron/approval-notify', 'cron_approval_notify_url');
create or replace function public.app_invoke_approval_notify()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'cron_approval_notify_url';
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'cron_secret';
  if v_url is null or v_secret is null then
    raise warning 'approval-notify: vault secrets (cron_approval_notify_url / cron_secret) が未設定です';
    return;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_secret,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
end;
$$;

revoke all on function public.app_invoke_approval_notify() from public;
revoke all on function public.app_invoke_approval_notify() from anon;
revoke all on function public.app_invoke_approval_notify() from authenticated;

-- スケジュール登録: 15分毎（pg_cronがある環境のみ）。
-- 夜間ingestの pending バッチを朝の早い段階で拾いつつ、即時送信失敗分を細かくリトライする。
-- 空振りは claim RPC が0件で返すだけなので24/7でも安価。
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from cron.job where jobname = 'approval-notify') then
      perform cron.schedule('approval-notify', '*/15 * * * *', 'select app_invoke_approval_notify()');
    end if;
  end if;
end $$;

-- =============================================================================
-- 検証（適用後にservice roleで実施）:
--   1) select vault.create_secret(...) で URL を登録し、select app_invoke_approval_notify();
--      → /api/cron/approval-notify が {claimed,sent,errors} を返すこと（pg_net ログで確認）
--   2) pending 候補（責任者リンクあり・在籍あり）を用意→cron起動→責任者1:1に確認Flexが届く
--   3) 退職者approverの pending は claim されず送られない（漏洩ガード）
--   4) 二重起動しても approval_notified_at で冪等（同一候補が二重に届かない）
-- ロールバック:
--   select cron.unschedule('approval-notify');
--   drop function app_invoke_approval_notify();
-- =============================================================================
