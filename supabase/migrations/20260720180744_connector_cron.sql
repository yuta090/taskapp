-- =============================================================================
-- connector 双方向同期の pg_cron 起動配線
-- =============================================================================
-- 20260720125427_connector_two_way_sync.sql で土台(テーブル/RPC/ワーカー)を入れた。
-- 本マイグレーションはその dispatch/import ワーカーを pg_cron から周期起動する。
--
-- 方式は 20260718092110_google_tasks_mirror.sql の app_invoke_task_mirror と完全に同型:
--   vault に登録した URL/secret を net.http_post で内部 cron API に POST する。
--   URL/secret の vault 登録は本番運用で別途行う(未設定なら warning を出して no-op)。
--
-- 2種のジョブ:
--   - connector-dispatch (*/5)  : connector_jobs を配達(multica送信 / gtasks完了書き戻し)
--   - connector-import   (*/15) : import_enabled な gtasks 接続を差分ポーリングして取り込み
--     ※ multica は webhook push で入ってくるため poll 不要。逆流ポーリングは gtasks のみ。
-- =============================================================================

create or replace function public.app_invoke_connector(p_kind text)
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
    where name = 'cron_connector_' || p_kind || '_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  if v_url is null or v_secret is null then
    raise warning 'connector(%): vault secrets 未設定', p_kind;
    return;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
    body := '{}'::jsonb
  );
end;
$$;

revoke all on function public.app_invoke_connector(text) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- 順方向 dispatch は5分間隔(mirror-dispatch と同ペース)
    if not exists (select 1 from cron.job where jobname = 'connector-dispatch') then
      perform cron.schedule('connector-dispatch', '*/5 * * * *', $cron$select app_invoke_connector('dispatch')$cron$);
    end if;
    -- 取り込み(逆流ポーリング)は15分間隔(gtasks クォータ配慮。updatedMin で差分)
    if not exists (select 1 from cron.job where jobname = 'connector-import') then
      perform cron.schedule('connector-import', '*/15 * * * *', $cron$select app_invoke_connector('import')$cron$);
    end if;
  end if;
end $$;
