-- 見積もりワークフロー: estimated_cost + estimate_status カラム追加
-- estimated_cost: 見積もり金額（円単位、整数）
-- estimate_status: 見積もりの状態管理

-- カスタム型
DO $$ BEGIN
  CREATE TYPE estimate_status AS ENUM ('none', 'pending', 'approved', 'rejected');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- tasks テーブルにカラム追加
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS estimated_cost integer,
  ADD COLUMN IF NOT EXISTS estimate_status estimate_status NOT NULL DEFAULT 'none';

-- インデックス: ポータルで見積もり確認待ちタスクの検索用
CREATE INDEX IF NOT EXISTS idx_tasks_estimate_pending
  ON tasks (space_id, estimate_status)
  WHERE estimate_status = 'pending';

COMMENT ON COLUMN tasks.estimated_cost IS '見積もり金額（円単位）';
COMMENT ON COLUMN tasks.estimate_status IS '見積もり状態: none=未設定, pending=確認待ち, approved=承認済み, rejected=却下';
