-- DDL v0.6: Subtask (parent-child) support
-- Design: 1-level hierarchy only (parent → child), no deep nesting
-- Parent task summary bar in Gantt is computed client-side from children's dates.

-- 1. Add parent_task_id column
ALTER TABLE tasks
  ADD COLUMN parent_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL;

-- 2. Index for efficient child lookup
CREATE INDEX idx_tasks_parent_task_id ON tasks(parent_task_id)
  WHERE parent_task_id IS NOT NULL;

-- 3. Constraint: prevent deep nesting (max 1 level)
--    A task with a parent cannot itself be a parent.
ALTER TABLE tasks
  ADD CONSTRAINT chk_no_deep_nesting
  CHECK (parent_task_id IS NULL OR id != parent_task_id);

-- Note: The 1-level constraint is also enforced application-side:
--   When setting parent_task_id, the app verifies that the target parent
--   does not itself have a parent_task_id.
--
-- Behavioral rules (enforced in app logic):
--   - Status: independent (parent and child statuses are managed separately)
--   - Ball ownership: independent
--   - Dates: parent's Gantt bar is auto-computed as min(child.start_date)..max(child.due_date)
--   - Drag: only child bars are draggable; parent summary bar is read-only
