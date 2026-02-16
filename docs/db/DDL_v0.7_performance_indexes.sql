-- DDL v0.7: Performance Indexes
-- 頻出クエリパターンに対する複合インデックス追加
--
-- 分析対象:
--   - useTasks.ts: tasks WHERE org_id AND space_id ORDER BY created_at DESC
--   - useMeetings.ts: meetings WHERE space_id ORDER BY held_at DESC
--   - useReviews.ts: reviews WHERE space_id ORDER BY created_at DESC
--   - useNotifications.ts: notifications WHERE to_user_id AND channel ORDER BY created_at DESC
--   - my/page.tsx: tasks WHERE assignee_id
--   - portal/page.tsx: tasks WHERE space_id AND ball AND status (multiple patterns)
--   - portal/tasks/page.tsx: tasks WHERE space_id AND ball AND status ORDER BY due_date
--   - portal/history: tasks WHERE space_id AND status='done' ORDER BY updated_at DESC
--
-- Note: DDL_v0.5 already defines tasks_portal_query_idx ON tasks(space_id, ball, client_scope, status)
-- The indexes below complement that with additional patterns.

-- =============================================================================
-- 1) tasks: Internal task list (useTasks.ts)
--    Query: WHERE org_id = ? AND space_id = ? ORDER BY created_at DESC LIMIT 50
-- =============================================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_org_space_created
  ON tasks (org_id, space_id, created_at DESC);

-- =============================================================================
-- 2) tasks: My tasks page (my/page.tsx)
--    Query: WHERE assignee_id = ?
--    Also useful for task assignment lookups across the app
-- =============================================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_assignee_id
  ON tasks (assignee_id)
  WHERE assignee_id IS NOT NULL;

-- =============================================================================
-- 3) tasks: Portal "client ball" queries (portal/page.tsx, portal/tasks/page.tsx)
--    Query: WHERE space_id = ? AND ball = 'client' AND status != 'done' ORDER BY due_date
--    Note: tasks_portal_query_idx covers (space_id, ball, client_scope, status)
--          but not the due_date ordering. This index specifically targets
--          the portal's client-facing task list with due_date sort.
-- =============================================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_portal_client_ball
  ON tasks (space_id, ball, status, due_date)
  WHERE ball = 'client' AND status != 'done';

-- =============================================================================
-- 4) tasks: Portal completed tasks (portal/history/page.tsx)
--    Query: WHERE space_id = ? AND status = 'done' ORDER BY updated_at DESC LIMIT 50
-- =============================================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_done_updated
  ON tasks (space_id, updated_at DESC)
  WHERE status = 'done';

-- =============================================================================
-- 5) meetings: Meeting list (useMeetings.ts)
--    Query: WHERE space_id = ? ORDER BY held_at DESC LIMIT 50
-- =============================================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meetings_space_held
  ON meetings (space_id, held_at DESC);

-- =============================================================================
-- 6) reviews: Review list (useReviews.ts)
--    Query: WHERE space_id = ? ORDER BY created_at DESC LIMIT 50
-- =============================================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reviews_space_created
  ON reviews (space_id, created_at DESC);

-- =============================================================================
-- 7) notifications: Notification list (useNotifications.ts)
--    Query: WHERE to_user_id = ? AND channel = 'in_app' ORDER BY created_at DESC LIMIT 50
-- =============================================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_user_channel_created
  ON notifications (to_user_id, channel, created_at DESC);

-- =============================================================================
-- 8) notifications: Unread count (useUnreadNotificationCount.ts)
--    Query: WHERE to_user_id = ? AND channel = 'in_app' AND read_at IS NULL
--    Also: WHERE to_user_id = ? AND channel = 'in_app' AND actioned_at IS NULL AND type IN (...)
-- =============================================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_unread
  ON notifications (to_user_id, channel)
  WHERE read_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_unactioned
  ON notifications (to_user_id, channel, type)
  WHERE actioned_at IS NULL;

-- =============================================================================
-- 9) task_owners: Owner lookup by task (useTasks.ts passBall)
--    Query: WHERE task_id = ?
--    Note: This likely already has an FK index, but explicit for clarity
-- =============================================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_task_owners_task_id
  ON task_owners (task_id);

-- =============================================================================
-- Estimated Impact:
--
-- | Query Pattern                    | Before (est.)   | After (est.)   |
-- |----------------------------------|-----------------|----------------|
-- | Task list (org+space)            | Seq scan        | Index scan     |
-- | My tasks (assignee)              | Seq scan        | Index scan     |
-- | Portal client ball tasks         | Partial idx use | Covered scan   |
-- | Completed tasks history          | Seq scan + sort | Index scan     |
-- | Meetings list                    | Seq scan + sort | Index scan     |
-- | Reviews list                     | Seq scan + sort | Index scan     |
-- | Notifications list               | Seq scan + sort | Index scan     |
-- | Unread notification count        | Seq scan + cnt  | Index-only     |
--
-- Notes:
-- - CONCURRENTLY is used to avoid locking tables during index creation
-- - Partial indexes (WHERE clause) reduce index size and improve cache hit rate
-- - Run during low-traffic periods for safety
-- =============================================================================
