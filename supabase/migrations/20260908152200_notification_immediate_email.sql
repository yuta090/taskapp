-- 即時メール（数分ためて1通）のための記録列とスケジュール。
--
-- 方針: 通知は「相手が待って止まるもの」だけその場でメールする。それ以外は今までどおり
-- 毎朝1回のまとめ（notification-digest）。種類の振り分けは
-- src/lib/notifications/delivery.ts が正本。
--
-- 二重送信を防ぐため「実際に即時メールで送ったか」をこの列に記録し、
-- 毎朝のまとめは送った行を除外する。
-- 「送る予定だったか」ではなく「送ったか」で判定するのが肝心で、
-- 夜間・休日に即時メールを止めた行はまとめ側で拾える。

alter table public.notifications
  add column if not exists immediate_email_sent_at timestamptz;

comment on column public.notifications.immediate_email_sent_at is
  '即時メールを実際に送った時刻。NULL = 未送信（毎朝のまとめの対象になる）';

-- 既存11列と同じ範囲に揃える（Realtime も列権限を見るため、ここだけ欠けると差分が届かなくなる）
grant select (immediate_email_sent_at) on public.notifications to authenticated;

-- 5分ごとのワーカーが引く「まだ送っていない最近の in_app 通知」を刺す
create index if not exists idx_notifications_immediate_pending
  on public.notifications (created_at)
  where channel = 'in_app' and immediate_email_sent_at is null;

-- =============================================================================
-- pg_cron スケジューリング（5分ごと・即時メール）
-- URL とシークレットは Vault から読む（このファイルには含めない）。
-- Vault 設定（未設定なら手動で1回だけ実行。cron_secret は既存の共有シークレット）:
--   select vault.create_secret('https://agentpm.app/api/cron/notification-immediate', 'cron_notification_immediate_url');
-- 適用: apply-migration.sh + applied_migrations へ手動記録（他マイグレーションと同様）。
-- =============================================================================

create or replace function app_invoke_notification_immediate()
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
    from vault.decrypted_secrets where name = 'cron_notification_immediate_url';
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'cron_secret';
  if v_url is null or v_secret is null then
    raise warning 'notification immediate: vault secrets (cron_notification_immediate_url / cron_secret) が未設定です';
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

revoke all on function app_invoke_notification_immediate() from public;
revoke all on function app_invoke_notification_immediate() from anon;
revoke all on function app_invoke_notification_immediate() from authenticated;

-- 静かな時間帯(JST 21時〜翌8時・土日)はAPI側で送らないので、cron は素直に5分ごとで回す。
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from cron.job where jobname = 'notification-immediate') then
      perform cron.schedule('notification-immediate', '*/5 * * * *', 'select app_invoke_notification_immediate()');
    end if;
  end if;
end $$;
