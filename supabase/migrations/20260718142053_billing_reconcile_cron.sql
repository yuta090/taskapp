-- Stripe reconcile cron（webhook 欠落是正の backstop・over-entitlement 対策）
-- webhook が subscription.updated(past_due/canceled) や deleted を取りこぼすと、
-- org_billing が stale な active のまま残り、失効した org が有料機能を持ち続ける。
-- これを毎時、Stripe のライブ状態から拾い直して閉じる（真実源は Stripe）。
--
-- app_invoke_billing_reconcile(): pg_cron → pg_net の内部インボーカー
--   （シークレットは Vault。このファイルには含めない）
--
-- 適用: psql 個別実行 + applied_migrations へ INSERT（docs/db/ の運用に従う）
-- Vault 設定（未設定なら手動で1回だけ。cron_secret は既存を再利用）:
--   select vault.create_secret('https://agentpm.app/api/cron/billing-reconcile', 'cron_billing_reconcile_url');
--
-- ロールバック:
--   select cron.unschedule('billing-reconcile');
--   drop function if exists app_invoke_billing_reconcile();

-- pg_cron → HTTP インボーカー。URL とシークレットは Vault から読む
create or replace function app_invoke_billing_reconcile()
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
    from vault.decrypted_secrets where name = 'cron_billing_reconcile_url';
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'cron_secret';
  if v_url is null or v_secret is null then
    raise warning 'billing reconcile: vault secrets (cron_billing_reconcile_url / cron_secret) が未設定です';
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

revoke all on function app_invoke_billing_reconcile() from public;
revoke all on function app_invoke_billing_reconcile() from anon;
revoke all on function app_invoke_billing_reconcile() from authenticated;

-- スケジュール登録: 毎時17分（他cronと分散）。over-entitlement 是正は毎時で十分
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from cron.job where jobname = 'billing-reconcile') then
      perform cron.schedule('billing-reconcile', '17 * * * *', 'select app_invoke_billing_reconcile()');
    end if;
  end if;
end $$;
