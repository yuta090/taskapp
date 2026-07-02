-- =============================================================================
-- Integration test for 20260703_000_collab_notifications.sql
-- Run inside a transaction (BEGIN/ROLLBACK) so it never pollutes data.
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/collab_notifications_test.sql
-- Any failed assertion RAISEs and aborts (non-zero exit).
--
-- RED (before migration): T1/T2/T3/T4 fail — no notifications, no ball return,
--                          no completion gate.
-- GREEN (after migration): all four print OK.
--
-- auth.uid() is driven via request.jwt.claims (Supabase reads 'sub').
-- =============================================================================
BEGIN;

-- Fixed identities ------------------------------------------------------------
--   dev   = internal SE who owns / requests review           (space admin)
--   emp   = internal colleague: assignee + required reviewer  (space editor)
\set dev   '11111111-1111-1111-1111-111111111111'
\set emp   '22222222-2222-2222-2222-222222222222'
\set org   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
\set space 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
\set task  'cccccccc-cccc-cccc-cccc-cccccccccccc'

INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, instance_id, aud, role)
VALUES
  (:'dev', 'dev@example.com',  '', now(), now(), now(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  (:'emp', 'emp@example.com',  '', now(), now(), now(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')
ON CONFLICT (id) DO NOTHING;

INSERT INTO profiles (id, display_name) VALUES
  (:'dev', '開発SE'), (:'emp', '同僚レビュアー')
ON CONFLICT (id) DO NOTHING;

INSERT INTO organizations (id, name) VALUES (:'org', 'テスト組織') ON CONFLICT DO NOTHING;
INSERT INTO spaces (id, org_id, type, name) VALUES (:'space', :'org', 'project', 'テストPJ') ON CONFLICT DO NOTHING;
INSERT INTO org_memberships (org_id, user_id, role) VALUES
  (:'org', :'dev', 'owner'), (:'org', :'emp', 'member') ON CONFLICT DO NOTHING;
INSERT INTO space_memberships (space_id, user_id, role) VALUES
  (:'space', :'dev', 'admin'), (:'space', :'emp', 'editor') ON CONFLICT DO NOTHING;

INSERT INTO tasks (id, org_id, space_id, title, status, ball, origin, type, created_by)
VALUES (:'task', :'org', :'space', '確認してほしい実装', 'in_progress', 'internal', 'internal', 'task', :'dev')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- T1: pass_ball to an internal colleague notifies them (社内↔社内 loop)
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', json_build_object('sub', :'dev')::text, true);
SELECT rpc_pass_ball(:'task', 'internal', '{}'::uuid[], ARRAY[:'emp']::uuid[], '確認をお願いします', NULL);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM notifications
    WHERE to_user_id = '22222222-2222-2222-2222-222222222222'
      AND type = 'ball_passed'
      AND channel = 'in_app'
      AND (payload->>'task_id') = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
  ) THEN
    RAISE EXCEPTION 'FAIL T1: ball_passed notification for internal owner not created';
  END IF;
  RAISE NOTICE 'OK T1: pass_ball notifies internal colleague';
END $$;

-- ---------------------------------------------------------------------------
-- T2: review_open notifies the pending reviewer (review_request)
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', json_build_object('sub', :'dev')::text, true);
SELECT rpc_review_open(:'task', ARRAY[:'emp']::uuid[], NULL);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM notifications
    WHERE to_user_id = '22222222-2222-2222-2222-222222222222'
      AND type = 'review_request'
      AND (payload->>'task_id') = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
  ) THEN
    RAISE EXCEPTION 'FAIL T2: review_request notification not created';
  END IF;
  RAISE NOTICE 'OK T2: review_open notifies reviewer';
END $$;

-- ---------------------------------------------------------------------------
-- T3: review_block hands ball back to dev + notifies the requester
-- ---------------------------------------------------------------------------
UPDATE tasks SET ball = 'client' WHERE id = :'task';  -- pretend it moved away
SELECT set_config('request.jwt.claims', json_build_object('sub', :'emp')::text, true);
SELECT rpc_review_block(:'task', '命名を修正してください', NULL);

DO $$
DECLARE v_ball text;
BEGIN
  SELECT ball INTO v_ball FROM tasks WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  IF v_ball <> 'internal' THEN
    RAISE EXCEPTION 'FAIL T3a: ball not returned to internal (got %)', v_ball;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM notifications
    WHERE to_user_id = '11111111-1111-1111-1111-111111111111'
      AND (payload->>'task_id') = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
      AND (payload->>'message') LIKE '%修正%'
  ) THEN
    RAISE EXCEPTION 'FAIL T3b: change-request notification for developer not created';
  END IF;
  RAISE NOTICE 'OK T3: review_block returns ball + notifies developer';
END $$;

-- ---------------------------------------------------------------------------
-- T4: completion gate blocks done while review is not approved
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_blocked boolean := false;
BEGIN
  BEGIN
    UPDATE tasks SET status = 'done' WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  EXCEPTION WHEN check_violation THEN
    v_blocked := true;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'FAIL T4: task reached done with an unapproved review';
  END IF;
  RAISE NOTICE 'OK T4: completion gate blocks unapproved done';
END $$;

-- ---------------------------------------------------------------------------
-- T5 (control): once approved, completion is allowed
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', json_build_object('sub', :'emp')::text, true);
SELECT rpc_review_approve(:'task', NULL);  -- emp is the only reviewer → review approved

DO $$
BEGIN
  UPDATE tasks SET status = 'done' WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  RAISE NOTICE 'OK T5: approved review allows completion';
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'FAIL T5: approved task could not complete (%)', SQLERRM;
END $$;

ROLLBACK;
