-- メール通知(日次ダイジェスト)の受信設定。ユーザー1人1行。
-- 設定画面(settings/notifications)の各トグルを保存し、cron(notification-digest)が参照する。
-- immediate送信は作らない（方針=日次まとめのみ）。各 on_* はダイジェストに含める種類の絞り込み。
-- digest_frequency: 'none'=送らない / 'daily'=毎日 / 'weekly'=週1。
-- last_digest_sent_at: 二重送信防止＋この時刻以降の通知だけを次回に含める。

create table if not exists public.notification_email_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email_enabled boolean not null default true,
  on_task_assigned boolean not null default true,
  on_task_mentioned boolean not null default true,
  on_review_request boolean not null default true,
  on_client_response boolean not null default true,
  on_meeting_reminder boolean not null default true,
  digest_frequency text not null default 'daily' check (digest_frequency in ('none','daily','weekly')),
  last_digest_sent_at timestamptz null,
  updated_at timestamptz not null default now()
);

alter table public.notification_email_prefs enable row level security;

-- 本人のみ自分の設定を読み書きできる（他人の設定は不可視）。
drop policy if exists "own notification email prefs select" on public.notification_email_prefs;
create policy "own notification email prefs select" on public.notification_email_prefs
  for select using (user_id = auth.uid());

drop policy if exists "own notification email prefs insert" on public.notification_email_prefs;
create policy "own notification email prefs insert" on public.notification_email_prefs
  for insert with check (user_id = auth.uid());

drop policy if exists "own notification email prefs update" on public.notification_email_prefs;
create policy "own notification email prefs update" on public.notification_email_prefs
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update on public.notification_email_prefs to authenticated;

-- updated_at 自動更新（既存テーブル群と同方式）
create or replace function public.update_notification_email_prefs_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_notification_email_prefs_updated_at on public.notification_email_prefs;
create trigger trg_notification_email_prefs_updated_at
  before update on public.notification_email_prefs
  for each row execute function public.update_notification_email_prefs_updated_at();

-- =============================================================================
-- pg_cron スケジューリング（毎朝1回・日次まとめメール）
-- URL とシークレットは Vault から読む（このファイルには含めない）。
-- Vault 設定（未設定なら手動で1回だけ実行。cron_secret は既存の共有シークレット）:
--   select vault.create_secret('https://agentpm.app/api/cron/notification-digest', 'cron_notification_digest_url');
--   -- cron_secret は client-reminders 等と共用（未作成なら）:
--   -- select vault.create_secret('<CRON_SECRETの値>', 'cron_secret');
-- 適用: apply-migration.sh + applied_migrations へ手動記録（他マイグレーションと同様）。
-- =============================================================================

create or replace function app_invoke_notification_digest()
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
    from vault.decrypted_secrets where name = 'cron_notification_digest_url';
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'cron_secret';
  if v_url is null or v_secret is null then
    raise warning 'notification digest: vault secrets (cron_notification_digest_url / cron_secret) が未設定です';
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

revoke all on function app_invoke_notification_digest() from public;
revoke all on function app_invoke_notification_digest() from anon;
revoke all on function app_invoke_notification_digest() from authenticated;

-- スケジュール登録: 毎朝8時 JST = 23時 UTC（前日）。pg_cron がある環境のみ。
-- weekly は cron 側では毎日叩き、API 側で JST月曜のみ送る（daily と同一ジョブで処理）。
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from cron.job where jobname = 'notification-digest') then
      perform cron.schedule('notification-digest', '0 23 * * *', 'select app_invoke_notification_digest()');
    end if;
  end if;
end $$;
