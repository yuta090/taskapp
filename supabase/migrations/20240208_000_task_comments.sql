-- Task Comments テーブル
-- タスクへのコメント機能

-- =============================================================================
-- 1) task_comments テーブル
-- =============================================================================

CREATE TABLE IF NOT EXISTS task_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz DEFAULT NULL
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_task_comments_task_id ON task_comments(task_id);
CREATE INDEX IF NOT EXISTS idx_task_comments_space_id ON task_comments(space_id);
CREATE INDEX IF NOT EXISTS idx_task_comments_user_id ON task_comments(user_id);
CREATE INDEX IF NOT EXISTS idx_task_comments_created_at ON task_comments(created_at);

-- コメント
COMMENT ON TABLE task_comments IS 'タスクへのコメント';
COMMENT ON COLUMN task_comments.content IS 'コメント本文';
COMMENT ON COLUMN task_comments.deleted_at IS '論理削除日時';

-- =============================================================================
-- 2) RLS ポリシー
-- =============================================================================

ALTER TABLE task_comments ENABLE ROW LEVEL SECURITY;

-- 閲覧: スペースメンバーのみ
CREATE POLICY "task_comments_select" ON task_comments
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM space_memberships sm
      WHERE sm.space_id = task_comments.space_id
        AND sm.user_id = auth.uid()
    )
  );

-- 作成: スペースメンバーのみ
CREATE POLICY "task_comments_insert" ON task_comments
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM space_memberships sm
      WHERE sm.space_id = task_comments.space_id
        AND sm.user_id = auth.uid()
    )
    AND user_id = auth.uid()
  );

-- 更新: 自分のコメントのみ
CREATE POLICY "task_comments_update" ON task_comments
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 削除: 自分のコメントのみ（論理削除）
CREATE POLICY "task_comments_delete" ON task_comments
  FOR DELETE
  USING (user_id = auth.uid());

-- =============================================================================
-- 3) 更新トリガー
-- =============================================================================

CREATE OR REPLACE FUNCTION update_task_comments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_task_comments_updated_at
  BEFORE UPDATE ON task_comments
  FOR EACH ROW
  EXECUTE FUNCTION update_task_comments_updated_at();
