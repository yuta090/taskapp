-- クライアント滞留リマインドメール基盤
-- - client_reminder_log: 送信済み記録（unique制約で同一スロット内の二重送信を構造的に防止）
-- - profiles.reminder_emails_enabled: クライアント側の配信オプトアウト
-- - app_invoke_client_reminders(): pg_cron から pg_net で API を叩くインボーカー
--   （シークレットは Vault に置く。このファイルには含めない）
--
-- 適用: psql 個別実行 + applied_migrations へ INSERT（docs/db/MIGRATION_AUDIT_2026-07-05.md 参照）
-- Vault 設定（未設定なら手動で1回だけ実行）:
--   select vault.create_secret('<CRON_SECRETの値>', 'cron_secret');
--   select vault.create_secret('https://agentpm.app/api/cron/client-reminders', 'cron_client_reminders_url');

create table if not exists client_reminder_log (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('overdue', 'due_today', 'stalled')),
  sent_on date not null,
  slot smallint not null check (slot in (0, 1, 2)),
  sent_at timestamptz not null default now()
);

create unique index if not exists client_reminder_log_dedupe_idx
  on client_reminder_log (task_id, recipient_user_id, kind, sent_on, slot);
create index if not exists client_reminder_log_sent_on_idx
  on client_reminder_log (sent_on);

alter table client_reminder_log enable row level security;
-- ポリシーなし = service_role のみ読み書き可（cron API 専用テーブル）

alter table profiles
  add column if not exists reminder_emails_enabled boolean not null default true;

comment on column profiles.reminder_emails_enabled is
  'クライアント向けリマインドメールの受信可否（ポータル設定から変更）';

-- pg_cron → HTTP インボーカー。URL とシークレットは Vault から読む
create or replace function app_invoke_client_reminders()
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
    from vault.decrypted_secrets where name = 'cron_client_reminders_url';
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'cron_secret';
  if v_url is null or v_secret is null then
    raise warning 'client reminders: vault secrets (cron_client_reminders_url / cron_secret) が未設定です';
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

revoke all on function app_invoke_client_reminders() from public;
revoke all on function app_invoke_client_reminders() from anon;
revoke all on function app_invoke_client_reminders() from authenticated;

-- スケジュール登録: 9時/13時/17時 JST = 0/4/8 UTC（pg_cron がある環境のみ）
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from cron.job where jobname = 'client-reminders') then
      perform cron.schedule('client-reminders', '0 0,4,8 * * *', 'select app_invoke_client_reminders()');
    end if;
  end if;
end $$;
