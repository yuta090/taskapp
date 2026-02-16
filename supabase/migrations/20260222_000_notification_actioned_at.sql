-- Add actioned_at to notifications
-- Tracks when user completed an action (approve, block, start work, etc.)
-- Separate from read_at so "mark all as read" doesn't create false positives.

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS actioned_at timestamptz NULL;
