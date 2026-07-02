-- パフォーマンス改善: tasks / reviews の欠落インデックス追加
--
-- 目的: 最頻出の一覧取得クエリ（space スコープ + created_at 降順）と
--       多階層サブタスクの子孫取得を支えるインデックスを補う。
--
-- 対象クエリ:
--   - fetchTasksQuery (src/lib/supabase/queries.ts):
--       tasks:   .eq('org_id').eq('space_id').order('created_at', desc)
--       reviews: .eq('org_id').eq('space_id').order('created_at', desc)
--     ※ space_id は 1 org に属するため org_id は実質冗長。space_id 先頭の
--       複合インデックスで org_id フィルタもほぼコストゼロで解決できる。
--   - useReviews (src/lib/hooks/useReviews.ts):
--       reviews: .eq('space_id').order('created_at', desc)
--   - 多階層サブタスク (20260310_000_multi_level_hierarchy.sql / DDL_v0.6_subtasks.sql):
--       tasks: parent_task_id による子孫取得・階層トリガのルックアップ
--
-- 破壊的変更: なし（インデックス追加のみ。既存データ・スキーマは変更しない）
--
-- ロック注意:
--   本マイグレーションは Supabase CLI によりトランザクション内で実行される。
--   そのため CREATE INDEX CONCURRENTLY は使用できない（トランザクション内で
--   実行不可のため確実に失敗する）。通常の CREATE INDEX は対象テーブルに
--   SHARE ロックを取得し、インデックス構築中は当該テーブルへの
--   「書き込み」をブロックする（読み取りはブロックしない）。
--   tasks / reviews が巨大な本番環境では、書き込みが一時停止する点に注意。
--   ダウンタイムを避けたい場合は、このマイグレーションを適用せず、
--   メンテナンス時間帯に手動で以下を個別実行すること:
--     CREATE INDEX CONCURRENTLY idx_tasks_space_created
--       ON tasks (space_id, created_at DESC);
--   （CONCURRENTLY はロックを最小化するが、トランザクション外での実行が必須）
--
-- 冪等性: すべて IF NOT EXISTS。再適用しても安全。

-- 1) tasks: space スコープ一覧取得（最頻出）の主インデックス
--    .eq('space_id') + .order('created_at', desc) を単一インデックスで解決。
CREATE INDEX IF NOT EXISTS idx_tasks_space_created
  ON tasks (space_id, created_at DESC);

-- 2) tasks: 多階層サブタスクの親子ルックアップ用。
--    DDL_v0.6_subtasks.sql と同名・同定義（部分インデックス）で定義するため、
--    既存環境に同インデックスが存在しても IF NOT EXISTS で安全に no-op となる。
--    子タスクは全体の少数のため WHERE 句付き部分インデックスでサイズを抑制
--    （既存の tasks_wiki_page_id_idx と同じ部分インデックス方針）。
CREATE INDEX IF NOT EXISTS idx_tasks_parent_task_id
  ON tasks (parent_task_id)
  WHERE parent_task_id IS NOT NULL;

-- 3) reviews: space 内レビュー取得（fetchTasksQuery のサブクエリ / useReviews）用。
CREATE INDEX IF NOT EXISTS idx_reviews_space_created
  ON reviews (space_id, created_at DESC);

-- org_id 単独インデックスは追加しない（判断根拠）:
--   tasks を org_id のみで絞る箇所は MyTasksClient のみだが、そこは
--   .eq('assignee_id', uid) が主フィルタで org_id は副次。選択性は
--   assignee_id 側にあり org_id 単独インデックスの効果は薄い。
--   最頻出パスは space_id を必ず伴うため (space_id, created_at DESC) で足りる。
--   書き込みの多い tasks テーブルへのインデックス過剰追加を避けるため見送る。
--
-- ロールバック（すべて可逆。データ損失なし）:
--   DROP INDEX IF EXISTS idx_tasks_space_created;
--   DROP INDEX IF EXISTS idx_reviews_space_created;
--   ※ idx_tasks_parent_task_id は DDL_v0.6_subtasks.sql 由来の可能性があり、
--     このマイグレーション以前から存在しうるため、ロールバック時に安易に
--     DROP しないこと（既存機能の階層ルックアップが劣化する）。
