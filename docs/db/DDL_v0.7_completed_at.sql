-- DDL v0.7: completed_at tracking for tasks and milestones
-- Design: DB triggers auto-manage completed_at — no app-level writes needed.
--
-- tasks.completed_at: set to now() when status → 'done', cleared when leaving 'done'
-- milestones.completed_at: set when ALL tasks in milestone are 'done' (count > 0),
--                          cleared when any task leaves 'done' or milestone becomes empty

-- ============================================================================
-- 1. Column additions
-- ============================================================================

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at timestamptz NULL;
COMMENT ON COLUMN tasks.completed_at IS
  'Timestamp when task status was set to done. Auto-managed by trigger.';

ALTER TABLE milestones ADD COLUMN IF NOT EXISTS completed_at timestamptz NULL;
COMMENT ON COLUMN milestones.completed_at IS
  'Timestamp when all tasks in this milestone reached done. Auto-managed by trigger. NULL if milestone has 0 tasks or any non-done tasks.';

-- Performance index for velocity calculation and burndown queries
CREATE INDEX IF NOT EXISTS tasks_completed_at_idx
  ON tasks (space_id, completed_at)
  WHERE completed_at IS NOT NULL;

-- ============================================================================
-- 2. Task completed_at trigger (BEFORE UPDATE)
-- ============================================================================

CREATE OR REPLACE FUNCTION trg_task_completed_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'done' AND (OLD.status IS NULL OR OLD.status <> 'done') THEN
    NEW.completed_at := now();
  END IF;
  IF OLD.status = 'done' AND NEW.status <> 'done' THEN
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_task_completed_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION trg_task_completed_at();

-- ============================================================================
-- 3. Task completed_at trigger (BEFORE INSERT)
-- ============================================================================

CREATE OR REPLACE FUNCTION trg_task_completed_at_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'done' THEN
    NEW.completed_at := now();
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_task_completed_at_insert
  BEFORE INSERT ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION trg_task_completed_at_insert();

-- ============================================================================
-- 4. Milestone auto-completion helper
-- ============================================================================

CREATE OR REPLACE FUNCTION check_and_update_milestone(p_milestone_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_total_count int;
  v_done_count int;
  v_current_completed_at timestamptz;
BEGIN
  SELECT completed_at INTO v_current_completed_at
  FROM milestones WHERE id = p_milestone_id;

  SELECT
    count(*),
    count(*) FILTER (WHERE status = 'done')
  INTO v_total_count, v_done_count
  FROM tasks
  WHERE milestone_id = p_milestone_id;

  -- Empty milestone → not complete
  IF v_total_count = 0 THEN
    IF v_current_completed_at IS NOT NULL THEN
      UPDATE milestones SET completed_at = NULL WHERE id = p_milestone_id;
    END IF;
    RETURN;
  END IF;

  -- All done → mark complete (idempotent: only if not already set)
  IF v_total_count = v_done_count AND v_current_completed_at IS NULL THEN
    UPDATE milestones SET completed_at = now() WHERE id = p_milestone_id;
  -- Any not done → clear completion
  ELSIF v_total_count <> v_done_count AND v_current_completed_at IS NOT NULL THEN
    UPDATE milestones SET completed_at = NULL WHERE id = p_milestone_id;
  END IF;
END $$;

-- ============================================================================
-- 5. Milestone auto-completion trigger (AFTER INSERT/UPDATE/DELETE ON tasks)
-- ============================================================================

CREATE OR REPLACE FUNCTION trg_check_milestone_completion()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.milestone_id IS NOT NULL THEN
      PERFORM check_and_update_milestone(OLD.milestone_id);
    END IF;
    RETURN OLD;
  END IF;

  -- On milestone_id change, recheck BOTH old and new
  IF TG_OP = 'UPDATE' AND OLD.milestone_id IS DISTINCT FROM NEW.milestone_id THEN
    IF OLD.milestone_id IS NOT NULL THEN
      PERFORM check_and_update_milestone(OLD.milestone_id);
    END IF;
  END IF;

  IF NEW.milestone_id IS NOT NULL THEN
    PERFORM check_and_update_milestone(NEW.milestone_id);
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER trg_check_milestone_completion
  AFTER INSERT OR UPDATE OF status, milestone_id OR DELETE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION trg_check_milestone_completion();
