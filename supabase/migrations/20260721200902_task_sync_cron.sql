-- =============================================================================
-- タスク同期（Backlog / Jooto / Jira / Redmine / Asana / Trello / Linear）の pg_cron 起動配線
--
-- 20260721193711_task_sync_credentials.sql で資格情報とホストの器を入れ、アプリ側に
-- 取り込みエンジン（src/lib/task-sync/）を実装した。本マイグレーションはその取り込みを
-- pg_cron から周期起動する。
--
-- 方式は 20260720180744_connector_cron.sql の app_invoke_connector と完全に同型
-- （vault に登録した URL/secret を net.http_post で内部 cron API に POST する）。
-- 既存関数をそのまま再利用するため、URL の vault キーは 'cron_connector_task_sync_url'
-- （kind='task_sync'）になる。secret は既存の 'cron_secret' を共有する。
--
-- なぜ既存の connector-import ジョブに相乗りさせないか:
--   connector-import は gtasks 専用ワーカー（google-tasks/import.ts）を叩くルートで、
--   こちらは provider 非依存のエンジンを叩く別ルート。同じジョブにまとめると、片方の障害が
--   もう片方の取り込みも巻き込む。担当が違うものは別ジョブに分ける。
--
-- 間隔を15分の一本にする理由:
--   ツールごとの呼び出し回数上限（例: Jooto は標準プランで**月100回**）への配慮は、
--   アダプタが宣言した最短間隔（minPollIntervalMinutes）に従ってランナー側が接続単位で
--   見送る。上限はツール固有の事実なので、スケジューラ側に散らさない。
--
-- 適用: 新規ジョブの登録のみ。既存ジョブ（connector-dispatch / connector-import /
--   task-mirror 系）には一切触れない。vault 未設定なら app_invoke_connector が warning を
--   出して no-op になるため、本番の vault 登録前に適用しても害はない。
-- =============================================================================

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- 取り込み（差分ポーリング）は15分間隔。gtasks の connector-import と同ペース。
    -- ジョブ名は既存の 'connector-import' と紛らわしくないよう 'task-sync-import' にする。
    if not exists (select 1 from cron.job where jobname = 'task-sync-import') then
      perform cron.schedule('task-sync-import', '*/15 * * * *', $cron$select app_invoke_connector('task_sync')$cron$);
    end if;
  end if;
end $$;

-- =============================================================================
-- 本番運用で別途必要な作業（このマイグレーションではできないこと）:
--   vault に 'cron_connector_task_sync_url' を登録する
--   （値: <アプリのURL>/api/cron/task-sync-import）。
--   'cron_secret' は既存ジョブと共有するため追加登録は不要。
--   未登録の間は app_invoke_connector が warning を出して何もしない（安全側）。
-- =============================================================================
