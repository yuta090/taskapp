-- DDL v0.5: client_scope カラム追加
-- クライアントポータルでのタスク可視性制御

-- ============================================================
-- 1. client_scope カラム追加
-- ============================================================

-- タスクテーブルに client_scope を追加
-- deliverable: クライアントポータルに表示（納品物・成果物関連）
-- internal: 非表示（リファクタ、技術負債、インフラ等）
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS client_scope text
  NOT NULL DEFAULT 'deliverable'
  CHECK (client_scope IN ('deliverable', 'internal'));

-- インデックス追加（ポータルクエリ最適化）
CREATE INDEX IF NOT EXISTS tasks_client_scope_idx ON tasks(client_scope);

-- 複合インデックス（ポータルクエリ用）
CREATE INDEX IF NOT EXISTS tasks_portal_query_idx
  ON tasks(space_id, ball, client_scope, status);

-- カラムコメント
COMMENT ON COLUMN tasks.client_scope IS
  'クライアントポータルでの可視性。deliverable=表示（納品物関連）, internal=非表示（内部作業）';

-- ============================================================
-- 2. 既存データの移行
-- ============================================================

-- 既存タスクは全て deliverable に設定（デフォルト値で既に設定済み）
-- 必要に応じて手動で internal に変更する運用

-- ============================================================
-- 3. RLSポリシー更新（必要に応じて）
-- ============================================================

-- クライアント向けのRLSポリシーがある場合は client_scope でフィルタを追加
-- 例: クライアントロールは client_scope = 'deliverable' のみ閲覧可能

-- 既存のクライアント向けポリシーを確認
-- SELECT * FROM pg_policies WHERE tablename = 'tasks';

-- ============================================================
-- 使用例
-- ============================================================

-- クライアントポータルでの取得クエリ
-- SELECT * FROM tasks
-- WHERE space_id = :space_id
--   AND ball = 'internal'
--   AND client_scope = 'deliverable'
--   AND status != 'done';

-- MCPからの設定
-- task_create: client_scope = 'deliverable' | 'internal'
-- task_update: client_scope を変更可能
-- task_list: client_scope でフィルタ可能
