-- Add start_date column to tasks table for Gantt chart start date persistence
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS start_date date;

-- Add comment for documentation
COMMENT ON COLUMN tasks.start_date IS 'Task start date for Gantt chart display. Nullable - falls back to created_at when null.';
