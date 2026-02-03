-- Postgres DDL v0.4 - Task Comments
-- Apply on top of DDL v0.3
--
-- Adds:
-- - task_comments: タスクに紐づくコメント（クライアントとの会話）
--
-- Design decisions:
-- - visibility で社内/クライアント向けを制御
-- - actor_id は profiles.id を参照（社内・クライアント共通）
-- - 削除は論理削除（deleted_at）
-- - 監査は task_events で COMMENT アクションとして記録

-- =============================================================================
-- 1) task_comments
-- =============================================================================

CREATE TABLE IF NOT EXISTS task_comments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  space_id      uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  task_id       uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,

  -- Author
  actor_id      uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Content
  body          text NOT NULL CHECK (char_length(body) > 0 AND char_length(body) <= 10000),

  -- Visibility control
  -- 'client': クライアントにも見える（クライアントポータルに表示）
  -- 'internal': 社内のみ（クライアントには非表示）
  visibility    text NOT NULL DEFAULT 'client' CHECK (visibility IN ('client', 'internal')),

  -- Optional: 返信先コメント（将来の引用返信用）
  reply_to_id   uuid NULL REFERENCES task_comments(id) ON DELETE SET NULL,

  -- Timestamps
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz NULL,  -- 論理削除

  -- Constraints
  CONSTRAINT task_comments_org_space_match CHECK (true)  -- RLSで制御
);

-- Indexes
CREATE INDEX IF NOT EXISTS task_comments_task_id_idx ON task_comments(task_id);
CREATE INDEX IF NOT EXISTS task_comments_actor_id_idx ON task_comments(actor_id);
CREATE INDEX IF NOT EXISTS task_comments_created_at_idx ON task_comments(created_at DESC);
CREATE INDEX IF NOT EXISTS task_comments_visibility_idx ON task_comments(visibility);

-- Composite index for common query: タスクのコメント一覧（削除済み除外、時系列）
CREATE INDEX IF NOT EXISTS task_comments_list_idx
  ON task_comments(task_id, created_at)
  WHERE deleted_at IS NULL;

-- =============================================================================
-- 2) RLS Policies
-- =============================================================================

ALTER TABLE task_comments ENABLE ROW LEVEL SECURITY;

-- 社内メンバー: 全コメント閲覧可能
CREATE POLICY task_comments_internal_select ON task_comments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM org_memberships om
      WHERE om.org_id = task_comments.org_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'member')
    )
  );

-- クライアント: visibility='client' のみ閲覧可能
CREATE POLICY task_comments_client_select ON task_comments
  FOR SELECT
  TO authenticated
  USING (
    visibility = 'client'
    AND EXISTS (
      SELECT 1 FROM org_memberships om
      WHERE om.org_id = task_comments.org_id
        AND om.user_id = auth.uid()
        AND om.role = 'client'
    )
  );

-- 挿入: 社内メンバー（visibility制限なし）
CREATE POLICY task_comments_insert_internal ON task_comments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    actor_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM org_memberships om
      WHERE om.org_id = task_comments.org_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'member')
    )
  );

-- 挿入: クライアント（visibility='client'のみ）
CREATE POLICY task_comments_insert_client ON task_comments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    actor_id = auth.uid()
    AND visibility = 'client'  -- クライアントはclientのみ
    AND EXISTS (
      SELECT 1 FROM org_memberships om
      WHERE om.org_id = task_comments.org_id
        AND om.user_id = auth.uid()
        AND om.role = 'client'
    )
  );

-- 更新: 社内メンバー（24時間以内、org/space/task変更不可）
CREATE POLICY task_comments_update_internal ON task_comments
  FOR UPDATE
  TO authenticated
  USING (
    actor_id = auth.uid()
    AND created_at > now() - interval '24 hours'
    AND deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM org_memberships om
      WHERE om.org_id = task_comments.org_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'member')
    )
  )
  WITH CHECK (
    actor_id = auth.uid()
    -- org_id, space_id, task_id は変更不可（トリガーで強制も可）
  );

-- 更新: クライアント（24時間以内、visibility='client'維持、org/space/task変更不可）
CREATE POLICY task_comments_update_client ON task_comments
  FOR UPDATE
  TO authenticated
  USING (
    actor_id = auth.uid()
    AND created_at > now() - interval '24 hours'
    AND deleted_at IS NULL
    AND visibility = 'client'  -- 既存がclientのみ
    AND EXISTS (
      SELECT 1 FROM org_memberships om
      WHERE om.org_id = task_comments.org_id
        AND om.user_id = auth.uid()
        AND om.role = 'client'
    )
  )
  WITH CHECK (
    actor_id = auth.uid()
    AND visibility = 'client'  -- 更新後もclientのみ
  );

-- 削除（論理削除）: 自分のコメントのみ
CREATE POLICY task_comments_soft_delete ON task_comments
  FOR UPDATE
  TO authenticated
  USING (
    actor_id = auth.uid()
    AND deleted_at IS NULL
  )
  WITH CHECK (
    deleted_at IS NOT NULL  -- deleted_at を設定する更新のみ許可
  );

-- =============================================================================
-- 3) Triggers
-- =============================================================================

-- 3a) updated_at 自動更新
CREATE OR REPLACE FUNCTION update_task_comments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS task_comments_updated_at_trigger ON task_comments;
CREATE TRIGGER task_comments_updated_at_trigger
  BEFORE UPDATE ON task_comments
  FOR EACH ROW
  EXECUTE FUNCTION update_task_comments_updated_at();

-- 3b) org_id, space_id, task_id 変更禁止（defense in depth）
CREATE OR REPLACE FUNCTION prevent_task_comment_move()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.org_id IS DISTINCT FROM NEW.org_id THEN
    RAISE EXCEPTION 'Cannot change org_id of comment';
  END IF;
  IF OLD.space_id IS DISTINCT FROM NEW.space_id THEN
    RAISE EXCEPTION 'Cannot change space_id of comment';
  END IF;
  IF OLD.task_id IS DISTINCT FROM NEW.task_id THEN
    RAISE EXCEPTION 'Cannot change task_id of comment';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS task_comments_prevent_move_trigger ON task_comments;
CREATE TRIGGER task_comments_prevent_move_trigger
  BEFORE UPDATE ON task_comments
  FOR EACH ROW
  EXECUTE FUNCTION prevent_task_comment_move();

-- =============================================================================
-- 4) Helper: コメント数をタスクに集計（オプション）
-- =============================================================================

-- タスクにコメント数カラムを追加（パフォーマンス用、オプション）
-- ALTER TABLE tasks ADD COLUMN IF NOT EXISTS comment_count int NOT NULL DEFAULT 0;

-- コメント追加時にカウント更新（オプション）
-- CREATE OR REPLACE FUNCTION update_task_comment_count()
-- RETURNS TRIGGER AS $$
-- BEGIN
--   IF TG_OP = 'INSERT' THEN
--     UPDATE tasks SET comment_count = comment_count + 1 WHERE id = NEW.task_id;
--   ELSIF TG_OP = 'UPDATE' AND OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
--     UPDATE tasks SET comment_count = comment_count - 1 WHERE id = NEW.task_id;
--   END IF;
--   RETURN NEW;
-- END;
-- $$ LANGUAGE plpgsql;

-- =============================================================================
-- 5) Usage Examples
-- =============================================================================

-- コメント投稿
-- INSERT INTO task_comments (org_id, space_id, task_id, actor_id, body, visibility)
-- VALUES ('org-uuid', 'space-uuid', 'task-uuid', 'user-uuid', 'デザイン確認しました。OKです！', 'client');

-- タスクのコメント一覧取得（クライアント向け）
-- SELECT tc.*, p.display_name as actor_name
-- FROM task_comments tc
-- JOIN profiles p ON p.id = tc.actor_id
-- WHERE tc.task_id = 'task-uuid'
--   AND tc.deleted_at IS NULL
--   AND tc.visibility = 'client'
-- ORDER BY tc.created_at ASC;

-- タスクのコメント一覧取得（社内向け - 全て表示）
-- SELECT tc.*, p.display_name as actor_name
-- FROM task_comments tc
-- JOIN profiles p ON p.id = tc.actor_id
-- WHERE tc.task_id = 'task-uuid'
--   AND tc.deleted_at IS NULL
-- ORDER BY tc.created_at ASC;
