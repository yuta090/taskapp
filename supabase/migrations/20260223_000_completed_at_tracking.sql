-- ============================================================================
-- Migration: Add completed_at to tasks and milestones
-- Description: タスク・マイルストーンの完了日時追跡
-- Created: 2026-02-23
-- ============================================================================

-- 1. tasks.completed_at カラム追加
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at timestamptz NULL;

COMMENT ON COLUMN tasks.completed_at IS
  'Timestamp when task status was set to done. Auto-managed by trigger.';

-- 2. milestones.completed_at カラム追加
ALTER TABLE milestones ADD COLUMN IF NOT EXISTS completed_at timestamptz NULL;

COMMENT ON COLUMN milestones.completed_at IS
  'Timestamp when all tasks in this milestone reached done. Auto-managed by trigger. NULL if milestone has 0 tasks or any non-done tasks.';

-- 3. tasks.completed_at のインデックス (velocity計算、バーンダウンで使用)
CREATE INDEX IF NOT EXISTS tasks_completed_at_idx
  ON tasks (space_id, completed_at)
  WHERE completed_at IS NOT NULL;

-- ============================================================================
-- 4. タスクステータス変更時の completed_at 自動管理トリガー (UPDATE)
-- ============================================================================
CREATE OR REPLACE FUNCTION trg_task_completed_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- status が 'done' に変わった場合 → completed_at をセット
  IF NEW.status = 'done' AND (OLD.status IS NULL OR OLD.status <> 'done') THEN
    NEW.completed_at := now();
  END IF;

  -- status が 'done' から別に変わった場合 → completed_at をクリア
  IF OLD.status = 'done' AND NEW.status <> 'done' THEN
    NEW.completed_at := NULL;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_task_completed_at ON tasks;
CREATE TRIGGER trg_task_completed_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION trg_task_completed_at();

-- ============================================================================
-- 5. INSERT 時も対応 (status='done' で直接作成される場合)
-- ============================================================================
CREATE OR REPLACE FUNCTION trg_task_completed_at_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'done' THEN
    NEW.completed_at := now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_task_completed_at_insert ON tasks;
CREATE TRIGGER trg_task_completed_at_insert
  BEFORE INSERT ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION trg_task_completed_at_insert();

-- ============================================================================
-- 6. マイルストーン完了状態の計算・更新ヘルパー
-- ============================================================================
CREATE OR REPLACE FUNCTION check_and_update_milestone(p_milestone_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_total_count int;
  v_done_count int;
  v_current_completed_at timestamptz;
BEGIN
  -- 現在の completed_at を取得
  SELECT completed_at INTO v_current_completed_at
  FROM milestones WHERE id = p_milestone_id;

  -- タスク数カウント
  SELECT
    count(*),
    count(*) FILTER (WHERE status = 'done')
  INTO v_total_count, v_done_count
  FROM tasks
  WHERE milestone_id = p_milestone_id;

  -- 0タスクのマイルストーンは自動完了しない
  IF v_total_count = 0 THEN
    IF v_current_completed_at IS NOT NULL THEN
      UPDATE milestones SET completed_at = NULL
      WHERE id = p_milestone_id;
    END IF;
    RETURN;
  END IF;

  -- 全タスク完了 → completed_at をセット (未設定の場合のみ)
  IF v_total_count = v_done_count AND v_current_completed_at IS NULL THEN
    UPDATE milestones SET completed_at = now()
    WHERE id = p_milestone_id;
  -- 未完了タスクあり → completed_at をクリア
  ELSIF v_total_count <> v_done_count AND v_current_completed_at IS NOT NULL THEN
    UPDATE milestones SET completed_at = NULL
    WHERE id = p_milestone_id;
  END IF;
END $$;

-- ============================================================================
-- 7. マイルストーン自動完了チェックトリガー
-- ============================================================================
CREATE OR REPLACE FUNCTION trg_check_milestone_completion()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_milestone_id uuid;
BEGIN
  -- DELETE の場合
  IF TG_OP = 'DELETE' THEN
    IF OLD.milestone_id IS NOT NULL THEN
      PERFORM check_and_update_milestone(OLD.milestone_id);
    END IF;
    RETURN OLD;
  END IF;

  -- milestone_id が変更された場合、旧マイルストーンも再チェック
  IF TG_OP = 'UPDATE' AND OLD.milestone_id IS DISTINCT FROM NEW.milestone_id THEN
    IF OLD.milestone_id IS NOT NULL THEN
      PERFORM check_and_update_milestone(OLD.milestone_id);
    END IF;
  END IF;

  -- 現在の(新しい)マイルストーンをチェック
  IF NEW.milestone_id IS NOT NULL THEN
    PERFORM check_and_update_milestone(NEW.milestone_id);
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_check_milestone_completion ON tasks;
CREATE TRIGGER trg_check_milestone_completion
  AFTER INSERT OR UPDATE OF status, milestone_id OR DELETE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION trg_check_milestone_completion();

-- ============================================================================
-- 8. 既存の完了済みタスクにバックフィル
-- ============================================================================
UPDATE tasks
SET completed_at = updated_at
WHERE status = 'done' AND completed_at IS NULL;

-- ============================================================================
-- 9. 既存マイルストーンの完了状態をバックフィル
-- ============================================================================
WITH milestone_stats AS (
  SELECT
    t.milestone_id,
    count(*) AS total,
    count(*) FILTER (WHERE t.status = 'done') AS done_count,
    max(t.updated_at) AS last_done_at
  FROM tasks t
  WHERE t.milestone_id IS NOT NULL
  GROUP BY t.milestone_id
  HAVING count(*) = count(*) FILTER (WHERE t.status = 'done')
     AND count(*) > 0
)
UPDATE milestones m
SET completed_at = ms.last_done_at::timestamptz
FROM milestone_stats ms
WHERE m.id = ms.milestone_id
  AND m.completed_at IS NULL;
