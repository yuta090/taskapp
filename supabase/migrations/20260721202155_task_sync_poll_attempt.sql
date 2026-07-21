-- =============================================================================
-- タスク同期: ポーリング試行時刻の記録（呼び出し回数上限の実効化）
--
-- 背景（このままだと壊れること）:
--   ポーリング間隔の判定を last_import_success_at だけで行うと、**失敗し続ける接続に対して
--   間隔が一切効かない**。呼び出し回数に厳しい上限があるツール（Jooto は標準プランで月100回）
--   では、失敗ループがそのまま上限の食い潰しになり、以後まったく同期できなくなる。
--   また、cron の実行が重なった場合、両方が同じ古い成功時刻を見て同じ全件取得を走らせる。
--
-- 対策:
--   last_poll_attempt_at を追加し、**外部を叩く前に**書く（楽観的な claim）。
--     - 失敗しても時刻は進むので、次サイクルは間隔を待つ＝上限を食い潰さない。
--     - 実行が重なっても、後発は更新済みの時刻を見て見送る（完全な排他ではないが、
--       秒単位で重なる場合を除いて実用上の二重実行を防げる。connector_jobs のような
--       lease を持ち込むほどの複雑さは、取り込みの冪等性（対応表の一意制約と条件付き完了）
--       があるため不要と判断）。
--   鮮度証明（last_import_success_at）は**成功時のみ前進**という契約を変えない。試行と成功を
--   別の列に分けるのが要点で、片方に兼務させると必ずどちらかの意味が壊れる。
--
-- 適用: 列追加のみ。既存行に影響しない（null=一度も試行していない扱い）。
-- =============================================================================

alter table public.integration_connections
  add column if not exists last_poll_attempt_at timestamptz null;

comment on column public.integration_connections.last_poll_attempt_at is
  'タスク同期の取り込みを最後に「試行」した時刻（成功・失敗を問わない）。外部を叩く前に書く。ツール固有の呼び出し回数上限を失敗ループや同時実行で食い潰さないための間隔判定に使う。鮮度証明は last_import_success_at（成功時のみ前進）が担い、こちらは兼務しない。';

-- 取り込み対象の抽出（import_enabled かつ active）で試行時刻順に見るための部分インデックス。
create index if not exists integration_connections_task_sync_poll_idx
  on public.integration_connections (last_poll_attempt_at)
  where import_enabled = true;
