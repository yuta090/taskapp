-- DDL v0.6: Subtask (parent-child) support
-- Design: 1-level hierarchy only (parent → child), no deep nesting
-- Parent task summary bar in Gantt is computed client-side from children's dates.

-- 1. Add parent_task_id column
ALTER TABLE tasks
  ADD COLUMN parent_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL;

-- 2. Index for efficient child lookup
CREATE INDEX idx_tasks_parent_task_id ON tasks(parent_task_id)
  WHERE parent_task_id IS NOT NULL;

-- 3. Basic constraint: prevent self-reference
ALTER TABLE tasks
  ADD CONSTRAINT chk_no_self_parent
  CHECK (parent_task_id IS NULL OR id != parent_task_id);

-- 4. Trigger: enforce 1-level hierarchy + same space_id
--    - A child task cannot be a parent of another task
--    - A task that is already a parent cannot become a child
--    - Parent and child must belong to the same space_id
CREATE OR REPLACE FUNCTION prevent_invalid_parent_task()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.parent_task_id IS NOT NULL THEN
    -- Check: parent must not be a child itself (no deep nesting)
    IF EXISTS (
      SELECT 1 FROM tasks WHERE id = NEW.parent_task_id AND parent_task_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Cannot set parent: target parent is already a child task (max 1 level)';
    END IF;

    -- Check: this task must not already be a parent of other tasks
    IF EXISTS (
      SELECT 1 FROM tasks WHERE parent_task_id = NEW.id
    ) THEN
      RAISE EXCEPTION 'Cannot set parent: this task already has children (max 1 level)';
    END IF;

    -- Check: parent and child must be in the same space
    IF (SELECT space_id FROM tasks WHERE id = NEW.parent_task_id) != NEW.space_id THEN
      RAISE EXCEPTION 'Cannot set parent: parent task must be in the same space';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_invalid_parent_task
  BEFORE INSERT OR UPDATE OF parent_task_id ON tasks
  FOR EACH ROW EXECUTE FUNCTION prevent_invalid_parent_task();

-- Behavioral rules (enforced in app logic):
--   - Status: independent (parent and child statuses are managed separately)
--   - Ball ownership: independent
--   - Dates: parent's Gantt bar is auto-computed as min(child.start_date)..max(child.due_date)
--   - Drag: only child bars are draggable; parent summary bar is read-only
