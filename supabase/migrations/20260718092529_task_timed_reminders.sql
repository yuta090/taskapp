-- 時刻指定タスクリマインド（③ timed LINE reminders・pro以上限定）
-- - tasks.remind_at:      このタスクのリマインドを送る絶対時刻（null=リマインドなし）
-- - tasks.remind_sent_at: 直近に送った絶対時刻（null=未送信）。remind_at を先送りすると
--                          selectDueTaskReminders 側で自動再アームされる（sent < remind_at）
-- - 部分インデックス:     cron が5分毎に「到来済み・未完了」を軽くスキャンするため
-- - app_invoke_task_reminders(): pg_cron → pg_net の内部インボーカー
--   （シークレットは Vault。このファイルには含めない）
--
-- 適用: psql 個別実行 + applied_migrations へ INSERT（docs/db/ の運用に従う）
-- Vault 設定（未設定なら手動で1回だけ。cron_secret は既存を再利用）:
--   select vault.create_secret('https://agentpm.app/api/cron/task-reminders', 'cron_task_reminders_url');
--
-- ロールバック:
--   select cron.unschedule('task-reminders');
--   drop function if exists app_invoke_task_reminders();
--   drop index if exists tasks_remind_due_idx;
--   alter table tasks drop column if exists remind_sent_at;
--   alter table tasks drop column if exists remind_at;

alter table tasks
  add column if not exists remind_at timestamptz,
  add column if not exists remind_sent_at timestamptz;

comment on column tasks.remind_at is
  '時刻指定リマインドの送信予定時刻（pro以上・LINEグループへ配信）。null=リマインドなし';
comment on column tasks.remind_sent_at is
  'リマインドを直近に送った時刻。remind_at を先送りすると再アームされる';

-- 到来済み・未完了・リマインド設定済みのみを対象にする部分インデックス
create index if not exists tasks_remind_due_idx
  on tasks (remind_at)
  where remind_at is not null and status <> 'done';

-- pg_cron → HTTP インボーカー。URL とシークレットは Vault から読む
create or replace function app_invoke_task_reminders()
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
    from vault.decrypted_secrets where name = 'cron_task_reminders_url';
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'cron_secret';
  if v_url is null or v_secret is null then
    raise warning 'task reminders: vault secrets (cron_task_reminders_url / cron_secret) が未設定です';
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

revoke all on function app_invoke_task_reminders() from public;
revoke all on function app_invoke_task_reminders() from anon;
revoke all on function app_invoke_task_reminders() from authenticated;

-- スケジュール登録: 5分毎（pg_cron がある環境のみ）。到来時刻から最大数分内に着弾する
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from cron.job where jobname = 'task-reminders') then
      perform cron.schedule('task-reminders', '*/5 * * * *', 'select app_invoke_task_reminders()');
    end if;
  end if;
end $$;
