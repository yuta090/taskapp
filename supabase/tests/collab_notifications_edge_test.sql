-- =============================================================================
-- Edge-case regression tests for 20260703_000_collab_notifications.sql
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/collab_notifications_edge_test.sql
-- Complements collab_notifications_test.sql (the AT happy-path) with boundaries:
--   E1 actor self-exclusion   E2 client-side notify   E3 gate scope
--   E4 re-open re-surfaces     E5 self-block no self-notify
-- Runs in a transaction and rolls back.
-- =============================================================================
BEGIN;

\set dev   '11111111-1111-1111-1111-111111111111'
\set emp   '22222222-2222-2222-2222-222222222222'
\set cli   '33333333-3333-3333-3333-333333333333'
\set org   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
\set space 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
\set tA    'cccccccc-0000-0000-0000-00000000000a'
\set tB    'cccccccc-0000-0000-0000-00000000000b'
\set tC    'cccccccc-0000-0000-0000-00000000000c'
\set tD    'cccccccc-0000-0000-0000-00000000000d'
\set tE    'cccccccc-0000-0000-0000-00000000000e'

INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, instance_id, aud, role)
VALUES
  (:'dev', 'dev@e.com', '', now(), now(), now(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  (:'emp', 'emp@e.com', '', now(), now(), now(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  (:'cli', 'cli@e.com', '', now(), now(), now(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')
ON CONFLICT (id) DO NOTHING;
INSERT INTO profiles (id, display_name) VALUES (:'dev','開発'),(:'emp','同僚'),(:'cli','客先') ON CONFLICT (id) DO NOTHING;
INSERT INTO organizations (id, name) VALUES (:'org', 'テスト') ON CONFLICT DO NOTHING;
INSERT INTO spaces (id, org_id, type, name) VALUES (:'space', :'org', 'project', 'PJ') ON CONFLICT DO NOTHING;
INSERT INTO space_memberships (space_id, user_id, role) VALUES
  (:'space', :'dev', 'admin'), (:'space', :'emp', 'editor'), (:'space', :'cli', 'client') ON CONFLICT DO NOTHING;
INSERT INTO tasks (id, org_id, space_id, title, status, ball, origin, type, created_by) VALUES
  (:'tA', :'org', :'space', 'A', 'in_progress', 'internal', 'internal', 'task', :'dev'),
  (:'tB', :'org', :'space', 'B', 'in_progress', 'internal', 'internal', 'task', :'dev'),
  (:'tC', :'org', :'space', 'C', 'in_progress', 'internal', 'internal', 'task', :'dev'),
  (:'tD', :'org', :'space', 'D', 'in_progress', 'internal', 'internal', 'task', :'dev'),
  (:'tE', :'org', :'space', 'E', 'in_progress', 'internal', 'internal', 'task', :'dev')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- E1: pass_ball notifies other owners but NOT the acting user
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', json_build_object('sub', :'dev')::text, true);
SELECT rpc_pass_ball(:'tA', 'internal', '{}'::uuid[], ARRAY[:'dev', :'emp']::uuid[], NULL, NULL);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM notifications WHERE to_user_id='11111111-1111-1111-1111-111111111111'
             AND type='ball_passed' AND (payload->>'task_id')='cccccccc-0000-0000-0000-00000000000a') THEN
    RAISE EXCEPTION 'FAIL E1: actor was self-notified on pass_ball';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM notifications WHERE to_user_id='22222222-2222-2222-2222-222222222222'
             AND type='ball_passed' AND (payload->>'task_id')='cccccccc-0000-0000-0000-00000000000a') THEN
    RAISE EXCEPTION 'FAIL E1: co-owner was not notified';
  END IF;
  RAISE NOTICE 'OK E1: actor excluded, co-owner notified';
END $$;

-- ---------------------------------------------------------------------------
-- E2: pass_ball to client notifies the CLIENT owner
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', json_build_object('sub', :'dev')::text, true);
SELECT rpc_pass_ball(:'tB', 'client', ARRAY[:'cli']::uuid[], '{}'::uuid[], NULL, NULL);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM notifications WHERE to_user_id='33333333-3333-3333-3333-333333333333'
             AND type='ball_passed' AND (payload->>'ball')='client'
             AND (payload->>'task_id')='cccccccc-0000-0000-0000-00000000000b') THEN
    RAISE EXCEPTION 'FAIL E2: client owner not notified on ball=client';
  END IF;
  RAISE NOTICE 'OK E2: client owner notified';
END $$;

-- ---------------------------------------------------------------------------
-- E3: gate blocks only 'done' — other transitions with an open review pass
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', json_build_object('sub', :'dev')::text, true);
SELECT rpc_review_open(:'tC', ARRAY[:'emp']::uuid[], NULL);   -- review is 'open' (unapproved)
DO $$
DECLARE v_done_blocked boolean := false;
BEGIN
  -- non-done transition must be allowed
  UPDATE tasks SET status = 'in_review' WHERE id = 'cccccccc-0000-0000-0000-00000000000c';
  -- done must be blocked
  BEGIN
    UPDATE tasks SET status = 'done' WHERE id = 'cccccccc-0000-0000-0000-00000000000c';
  EXCEPTION WHEN check_violation THEN v_done_blocked := true;
  END;
  IF NOT v_done_blocked THEN
    RAISE EXCEPTION 'FAIL E3: done was not blocked with unapproved review';
  END IF;
  RAISE NOTICE 'OK E3: gate scoped to done only (in_review allowed, done blocked)';
END $$;

-- ---------------------------------------------------------------------------
-- E4: re-opening a review re-surfaces the reviewer's notification as unread
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', json_build_object('sub', :'dev')::text, true);
SELECT rpc_review_open(:'tD', ARRAY[:'emp']::uuid[], NULL);
UPDATE notifications SET read_at = now()
  WHERE to_user_id = :'emp' AND type='review_request' AND (payload->>'task_id') = :'tD';
SELECT rpc_review_open(:'tD', ARRAY[:'emp']::uuid[], NULL);   -- re-open
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM notifications WHERE to_user_id='22222222-2222-2222-2222-222222222222'
             AND type='review_request' AND (payload->>'task_id')='cccccccc-0000-0000-0000-00000000000d'
             AND read_at IS NOT NULL) THEN
    RAISE EXCEPTION 'FAIL E4: re-opened review did not re-surface as unread';
  END IF;
  RAISE NOTICE 'OK E4: re-open re-surfaces notification as unread';
END $$;

-- ---------------------------------------------------------------------------
-- E5: blocking your own review does not self-notify the requester
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', json_build_object('sub', :'dev')::text, true);
SELECT rpc_review_open(:'tE', ARRAY[:'dev']::uuid[], NULL);   -- dev is both requester and reviewer
SELECT rpc_review_block(:'tE', '自分で確認して差し戻し', NULL);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM notifications WHERE to_user_id='11111111-1111-1111-1111-111111111111'
             AND (payload->>'task_id')='cccccccc-0000-0000-0000-00000000000e'
             AND (payload->>'message') LIKE '%差し戻し%') THEN
    RAISE EXCEPTION 'FAIL E5: self-block produced a self-notification';
  END IF;
  RAISE NOTICE 'OK E5: self-block does not self-notify';
END $$;

ROLLBACK;
