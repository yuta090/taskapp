-- Add actual_hours column to tasks table for estimation assist feature
-- Tracks actual hours spent on completed tasks
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS actual_hours numeric NULL;

-- Add comment for documentation
COMMENT ON COLUMN tasks.actual_hours IS 'Actual hours spent on the task (entered after completion)';
