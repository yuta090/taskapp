-- ブラウザ通知(Web Push)購読基盤
-- - push_subscriptions: ブラウザごとのPush購読情報(endpoint/鍵)。認証済みユーザーが自分の行のみ操作可能。
-- - notifications INSERT時にトリガーで dispatch API を呼び出す(pg_net + Vault secrets)。
--   実際のpush送信はAPI側(web-push)が担う。トリガーはURLを叩くだけで送信結果を待たない。
--
-- 適用: psql 個別実行 + applied_migrations へ INSERT（docs/db/MIGRATION_AUDIT_2026-07-05.md 参照）
-- Vault 設定（未設定なら手動で1回だけ実行）:
--   select vault.create_secret('https://agentpm.app/api/push/dispatch', 'push_dispatch_url');
--   select vault.create_secret('<CRON_SECRETの値>', 'cron_secret');  -- 既存キーを再利用

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz null
);

create index if not exists push_subscriptions_user_idx
  on push_subscriptions(user_id);

alter table push_subscriptions enable row level security;

-- authenticated は自分の購読行のみ select/insert/update/delete 可能。
-- service_role (dispatch API) は RLS をバイパスするため対象外・影響なし。
drop policy if exists "users can view own push subscriptions" on push_subscriptions;
create policy "users can view own push subscriptions"
  on push_subscriptions for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "users can insert own push subscriptions" on push_subscriptions;
create policy "users can insert own push subscriptions"
  on push_subscriptions for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "users can update own push subscriptions" on push_subscriptions;
create policy "users can update own push subscriptions"
  on push_subscriptions for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "users can delete own push subscriptions" on push_subscriptions;
create policy "users can delete own push subscriptions"
  on push_subscriptions for delete
  to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on table push_subscriptions to authenticated;

-- notifications INSERT → dispatch API 呼び出し(SECURITY DEFINER, Vaultからシークレット取得)
create or replace function app_push_dispatch_hook()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_secret text;
begin
  -- Vault読み取りからhttp_postまで全体を例外ガードで囲む: vaultスキーマや
  -- pg_netが無い環境でも、プッシュ配信の失敗が通知INSERTのトランザクション
  -- 自体を失敗させてはならない。
  begin
    select decrypted_secret into v_url
      from vault.decrypted_secrets where name = 'push_dispatch_url';
    select decrypted_secret into v_secret
      from vault.decrypted_secrets where name = 'cron_secret';

    if v_url is null or v_secret is null then
      -- Vault未設定環境ではプッシュを送らないだけ。
      return new;
    end if;

    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_secret
      ),
      body := jsonb_build_object('notificationId', new.id)
    );
  exception when others then
    null;
  end;

  return new;
end;
$$;

revoke all on function app_push_dispatch_hook() from public;
revoke all on function app_push_dispatch_hook() from anon;
revoke all on function app_push_dispatch_hook() from authenticated;

drop trigger if exists notifications_push_dispatch on notifications;
create trigger notifications_push_dispatch
  after insert on notifications
  for each row
  when (new.channel = 'in_app')
  execute function app_push_dispatch_hook();

-- pg_net / vault が無い環境向けの防御(20260705220354_client_reminder_emails.sql と同方針):
-- 拡張が無くてもmigration自体は失敗させず、警告のみ出す。
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise warning 'web push: pg_net 拡張が見つかりません。app_push_dispatch_hook は Vault未設定と同様に何もせずreturnします。';
  end if;
end $$;
