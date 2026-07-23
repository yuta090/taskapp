-- =============================================================================
-- Google Chat 本格実装 PR-d: 購読ライフサイクルの自己修復cron（pg_cron 起動配線）
-- =============================================================================
-- 20260723152314_channel_event_subscriptions.sql（PR-a）で購読状態テーブル・store CRUD を
-- 入れた。20260721152510_due_reminder_cron.sql（app_invoke_due_reminder）と完全に同型:
--   vault に登録した URL/secret を net.http_post で内部 cron API に POST する。
--
-- 本migrationはこの1本のジョブだけを登録する(DDL/RPC/トリガーには一切触れない)。
--
--   - google-chat-subscriptions (*/10 * * * *) 10分毎:
--       /api/cron/google-chat-subscriptions を叩く。inline hookは無く、
--       「active claimed google_chat グループには生きた購読があり、そうでない購読は消えている」
--       状態へ毎回収束させる(create-missing / renew-expiring / delete-orphaned)。
--       onboarding遅延を抑えるため他cron(due-reminder等は毎時/5分毎)より短い10分間隔にする。
--
-- 必要な vault シークレット(本番運用で別途登録。未設定なら warning を出して no-op):
--   - cron_google_chat_subscriptions_url : 内部API URL
--       例) https://<app>/api/cron/google-chat-subscriptions
--   - cron_secret                        : 既存の共有シークレット(他 cron と共用)。
-- TS route 側の認証: 本関数は Authorization: Bearer <cron_secret> を付けて POST する。
--   route 実装(本PR同梱: src/app/api/cron/google-chat-subscriptions/route.ts)は
--   環境変数 CRON_SECRET と突合して認可する。
--
-- 適用: アプリ稼働中に本番共用DBへ適用可(新規関数＋cron登録のみ・既存を壊さない)。
--   vault未設定でも no-op のため安全(本番vault登録は運用側で別途実施)。
-- ロールバック: drop function public.app_invoke_google_chat_subscriptions();
--   および cron.unschedule('google-chat-subscriptions')。可逆(新規追加のみ)。
-- =============================================================================

create or replace function public.app_invoke_google_chat_subscriptions()
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
    where name = 'cron_google_chat_subscriptions_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  if v_url is null or v_secret is null then
    raise warning 'google chat subscriptions: vault secrets 未設定';
    return;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
    body := '{}'::jsonb
  );
end;
$$;

revoke all on function public.app_invoke_google_chat_subscriptions() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from cron.job where jobname = 'google-chat-subscriptions') then
      perform cron.schedule(
        'google-chat-subscriptions',
        '*/10 * * * *',
        $cron$select app_invoke_google_chat_subscriptions()$cron$
      );
    end if;
  end if;
end $$;

-- =============================================================================
-- 検証（適用後に service role で実施）:
--   1) select * from cron.job where jobname = 'google-chat-subscriptions'; で1行登録されている
--   2) vault未設定のまま select app_invoke_google_chat_subscriptions(); を実行しても
--      例外にならず warning のみ(no-op)
--   3) vault登録後、10分以内に /api/cron/google-chat-subscriptions への POST が観測できる
-- ロールバック:
--   select cron.unschedule('google-chat-subscriptions');
--   drop function public.app_invoke_google_chat_subscriptions();
-- =============================================================================
