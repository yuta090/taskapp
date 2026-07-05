-- Task Comments テーブル
-- タスクへのコメント機能
--
-- NOTE: 実テーブルは actor_id/body/visibility/reply_to_id スキーマ。
-- 以前このファイルは user_id/content 前提だったが、実DBと乖離していたため
-- 現行スキーマ（本ファイルが唯一の作成元）に合わせて書き直した。
-- visibility の許容値は後続の 20260308_000_agency_mode_foundation.sql で
-- ('client','internal','vendor','agency_only') に拡張される。

-- =============================================================================
-- 1) task_comments テーブル
-- =============================================================================

CREATE TABLE IF NOT EXISTS task_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL,
  visibility text NOT NULL DEFAULT 'client'
    CHECK (visibility IN ('client', 'internal')),
  reply_to_id uuid REFERENCES task_comments(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz DEFAULT NULL
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_task_comments_task_id ON task_comments(task_id);
CREATE INDEX IF NOT EXISTS idx_task_comments_space_id ON task_comments(space_id);
-- 注: 命名は歴史的経緯で user_id だが列は actor_id
CREATE INDEX IF NOT EXISTS idx_task_comments_user_id ON task_comments(actor_id);
CREATE INDEX IF NOT EXISTS idx_task_comments_created_at ON task_comments(created_at);

-- コメント
COMMENT ON TABLE task_comments IS 'タスクへのコメント';
COMMENT ON COLUMN task_comments.body IS 'コメント本文';
COMMENT ON COLUMN task_comments.deleted_at IS '論理削除日時';

-- =============================================================================
-- 2) RLS ポリシー
-- =============================================================================

ALTER TABLE task_comments ENABLE ROW LEVEL SECURITY;

-- 閲覧: スペースメンバーのみ
DROP POLICY IF EXISTS "task_comments_select" ON task_comments;
CREATE POLICY "task_comments_select" ON task_comments
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM space_memberships sm
      WHERE sm.space_id = task_comments.space_id
        AND sm.user_id = auth.uid()
    )
  );

-- 作成: スペースメンバー かつ 自分名義のみ
DROP POLICY IF EXISTS "task_comments_insert" ON task_comments;
CREATE POLICY "task_comments_insert" ON task_comments
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM space_memberships sm
      WHERE sm.space_id = task_comments.space_id
        AND sm.user_id = auth.uid()
    )
    AND actor_id = auth.uid()
  );

-- 更新: 自分のコメントのみ
DROP POLICY IF EXISTS "task_comments_update" ON task_comments;
CREATE POLICY "task_comments_update" ON task_comments
  FOR UPDATE
  USING (actor_id = auth.uid());

-- 削除: 自分のコメントのみ（論理削除）
DROP POLICY IF EXISTS "task_comments_delete" ON task_comments;
CREATE POLICY "task_comments_delete" ON task_comments
  FOR DELETE
  USING (actor_id = auth.uid());

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

DROP TRIGGER IF EXISTS trigger_task_comments_updated_at ON task_comments;
CREATE TRIGGER trigger_task_comments_updated_at
  BEFORE UPDATE ON task_comments
  FOR EACH ROW
  EXECUTE FUNCTION update_task_comments_updated_at();
