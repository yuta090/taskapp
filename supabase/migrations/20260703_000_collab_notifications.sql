-- =============================================================================
-- Collaboration notifications + state-machine enforcement
-- =============================================================================
-- Problem (verified in code audit):
--   * in_app notifications for review_request / ball_passed were NEVER generated
--     at runtime — they only existed in seed data. The Inbox action loop never
--     closed in production.
--   * rpc_review_block did not move the ball back to the developer, so a
--     change-request never became an actionable "対応すべき" state.
--   * Review completion was advisory only (UI display); a task could reach
--     'done' with unapproved required reviewers.
--
-- This migration (single source of truth = the RPCs) adds:
--   1. rpc_pass_ball      → notify new owners on the receiving side (ball_passed)
--   2. rpc_review_open    → notify pending reviewers (review_request)
--   3. rpc_review_block   → ball back to 'internal' + notify the review requester
--   4. enforce_review_gate trigger → block status→'done' with unapproved review
--
-- Notes:
--   * All notification inserts are ON CONFLICT DO UPDATE so a repeated action
--     re-surfaces the notification as unread (read_at reset, created_at bumped).
--   * The actor is never notified of their own action.
--   * Behaviour is otherwise identical to the prior function definitions.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helper: create (or re-surface) an in_app task notification
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION _create_task_notification(
  p_org_id uuid,
  p_space_id uuid,
  p_to_user_id uuid,
  p_type text,
  p_dedupe_key text,
  p_payload jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_to_user_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO notifications (org_id, space_id, to_user_id, channel, type, dedupe_key, payload)
  VALUES (p_org_id, p_space_id, p_to_user_id, 'in_app', p_type, p_dedupe_key, p_payload)
  ON CONFLICT (to_user_id, channel, dedupe_key)
  DO UPDATE SET payload = excluded.payload, read_at = NULL, created_at = now();
END;
$$;


-- =============================================================================
-- 1. rpc_pass_ball — notify new owners on the receiving side
-- =============================================================================
CREATE OR REPLACE FUNCTION rpc_pass_ball(
  p_task_id uuid,
  p_ball text,
  p_client_owner_ids uuid[] DEFAULT '{}',
  p_internal_owner_ids uuid[] DEFAULT '{}',
  p_reason text DEFAULT NULL,
  p_meeting_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_task tasks%ROWTYPE;
  v_actor_id uuid;
  v_org_id uuid;
  v_space_id uuid;
  v_actor_name text;
  v_recipient_ids uuid[];
  v_recipient uuid;
BEGIN
  -- Get current user
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Get task info
  SELECT * INTO v_task FROM tasks WHERE id = p_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found: %', p_task_id;
  END IF;

  v_org_id := v_task.org_id;
  v_space_id := v_task.space_id;

  -- Validate: ball='client' requires at least one client owner
  IF p_ball = 'client' AND array_length(p_client_owner_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Client owner required when ball=client';
  END IF;

  -- Update task ball
  UPDATE tasks SET ball = p_ball, updated_at = now() WHERE id = p_task_id;

  -- Delete existing owners and insert new ones
  DELETE FROM task_owners WHERE task_id = p_task_id;

  -- Insert client owners
  IF array_length(p_client_owner_ids, 1) > 0 THEN
    INSERT INTO task_owners (org_id, space_id, task_id, side, user_id)
    SELECT v_org_id, v_space_id, p_task_id, 'client', unnest(p_client_owner_ids);
  END IF;

  -- Insert internal owners
  IF array_length(p_internal_owner_ids, 1) > 0 THEN
    INSERT INTO task_owners (org_id, space_id, task_id, side, user_id)
    SELECT v_org_id, v_space_id, p_task_id, 'internal', unnest(p_internal_owner_ids);
  END IF;

  -- Create audit log
  INSERT INTO task_events (org_id, space_id, task_id, actor_id, meeting_id, action, payload)
  VALUES (
    v_org_id,
    v_space_id,
    p_task_id,
    v_actor_id,
    p_meeting_id,
    'PASS_BALL',
    jsonb_build_object(
      'ball', p_ball,
      'clientOwnerIds', p_client_owner_ids,
      'internalOwnerIds', p_internal_owner_ids,
      'reason', p_reason
    )
  );

  -- Notify the owners on the receiving side (the side that must now act).
  -- This is what closes the "confirm / act next" loop for internal↔internal too.
  v_recipient_ids := CASE WHEN p_ball = 'client' THEN p_client_owner_ids ELSE p_internal_owner_ids END;
  SELECT display_name INTO v_actor_name FROM profiles WHERE id = v_actor_id;

  IF array_length(v_recipient_ids, 1) > 0 THEN
    FOREACH v_recipient IN ARRAY v_recipient_ids LOOP
      IF v_recipient <> v_actor_id THEN
        PERFORM _create_task_notification(
          v_org_id,
          v_space_id,
          v_recipient,
          'ball_passed',
          format('ball_passed:%s:%s', p_task_id, v_recipient),
          jsonb_build_object(
            'task_id', p_task_id,
            'task_title', v_task.title,
            'title', format('「%s」があなたの番です', v_task.title),
            'message', COALESCE(p_reason, 'ボールがあなたに渡されました。対応を開始してください。'),
            'from_user_name', v_actor_name,
            'ball', p_ball
          )
        );
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;


-- =============================================================================
-- 2. rpc_review_open — notify pending reviewers (review_request)
--    (extends the 20260218 approval-preserving version)
-- =============================================================================
CREATE OR REPLACE FUNCTION rpc_review_open(
  p_task_id uuid,
  p_reviewer_ids uuid[],
  p_meeting_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_task tasks%ROWTYPE;
  v_actor_id uuid;
  v_review_id uuid;
  v_existing_reviewer_ids uuid[];
  v_has_pending boolean;
  v_final_status text;
  v_actor_name text;
  v_pending_reviewer uuid;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Sanitize reviewer IDs: remove NULLs and deduplicate
  p_reviewer_ids := ARRAY(
    SELECT DISTINCT rid FROM unnest(p_reviewer_ids) AS rid WHERE rid IS NOT NULL
  );

  -- Validate reviewers
  IF array_length(p_reviewer_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'At least one reviewer required';
  END IF;

  -- Get task
  SELECT * INTO v_task FROM tasks WHERE id = p_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found: %', p_task_id;
  END IF;

  -- Security: Verify caller is a member of the task's space (admin or editor)
  IF NOT EXISTS (
    SELECT 1 FROM space_memberships
    WHERE space_id = v_task.space_id
      AND user_id = v_actor_id
      AND role IN ('admin', 'editor')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions: you must be an admin or editor in this space';
  END IF;

  -- Security: Verify all reviewer IDs are members of the same space
  IF EXISTS (
    SELECT rid FROM unnest(p_reviewer_ids) AS rid
    WHERE rid NOT IN (
      SELECT user_id FROM space_memberships WHERE space_id = v_task.space_id
    )
  ) THEN
    RAISE EXCEPTION 'One or more reviewer IDs are not members of this space';
  END IF;

  -- Upsert review (task_id is UNIQUE) — status determined after approval updates
  INSERT INTO reviews (org_id, space_id, task_id, status, created_by)
  VALUES (v_task.org_id, v_task.space_id, p_task_id, 'open', v_actor_id)
  ON CONFLICT (task_id) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_review_id;

  -- Get currently existing reviewer IDs
  SELECT COALESCE(array_agg(reviewer_id), '{}')
  INTO v_existing_reviewer_ids
  FROM review_approvals
  WHERE review_id = v_review_id;

  -- Remove reviewers no longer in the list
  DELETE FROM review_approvals
  WHERE review_id = v_review_id
    AND reviewer_id != ALL(p_reviewer_ids);

  -- Add only NEW reviewers as 'pending' (preserve existing approvals)
  INSERT INTO review_approvals (org_id, review_id, reviewer_id, state)
  SELECT v_task.org_id, v_review_id, rid, 'pending'
  FROM unnest(p_reviewer_ids) AS rid
  WHERE rid != ALL(v_existing_reviewer_ids);

  -- Reset 'blocked' reviewers back to 'pending' on re-review
  -- (approved items are preserved per REVIEW_SPEC)
  UPDATE review_approvals
  SET state = 'pending', blocked_reason = NULL, updated_at = now()
  WHERE review_id = v_review_id AND state = 'blocked';

  -- Re-evaluate review status based on current approval states
  SELECT EXISTS (
    SELECT 1 FROM review_approvals
    WHERE review_id = v_review_id AND state = 'pending'
  ) INTO v_has_pending;

  IF v_has_pending THEN
    v_final_status := 'open';
  ELSE
    v_final_status := 'approved';
  END IF;

  UPDATE reviews SET status = v_final_status, updated_at = now()
  WHERE id = v_review_id;

  -- Create audit log
  INSERT INTO task_events (org_id, space_id, task_id, actor_id, meeting_id, action, payload)
  VALUES (
    v_task.org_id,
    v_task.space_id,
    p_task_id,
    v_actor_id,
    p_meeting_id,
    'REVIEW_OPEN',
    jsonb_build_object('reviewerIds', p_reviewer_ids)
  );

  -- Notify every reviewer who currently needs to act (state='pending').
  -- Covers both newly-added reviewers and blocked→pending re-reviews.
  SELECT display_name INTO v_actor_name FROM profiles WHERE id = v_actor_id;

  FOR v_pending_reviewer IN
    SELECT reviewer_id FROM review_approvals
    WHERE review_id = v_review_id AND state = 'pending'
  LOOP
    IF v_pending_reviewer <> v_actor_id THEN
      PERFORM _create_task_notification(
        v_task.org_id,
        v_task.space_id,
        v_pending_reviewer,
        'review_request',
        format('review_request:%s:%s', v_review_id, v_pending_reviewer),
        jsonb_build_object(
          'task_id', p_task_id,
          'task_title', v_task.title,
          'title', format('レビュー依頼: 「%s」', v_task.title),
          'message', 'レビューをお願いします。承認または差し戻し（理由必須）で回答してください。',
          'from_user_name', v_actor_name
        )
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true);
END;
$$;


-- =============================================================================
-- 3. rpc_review_block — ball back to developer + notify the requester
-- =============================================================================
CREATE OR REPLACE FUNCTION rpc_review_block(
  p_task_id uuid,
  p_blocked_reason text,
  p_meeting_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_task tasks%ROWTYPE;
  v_actor_id uuid;
  v_review_id uuid;
  v_requester_id uuid;
  v_actor_name text;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Get task
  SELECT * INTO v_task FROM tasks WHERE id = p_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found: %', p_task_id;
  END IF;

  -- Get review (+ requester for the ball hand-back notification)
  SELECT id, created_by INTO v_review_id, v_requester_id
  FROM reviews WHERE task_id = p_task_id;
  IF v_review_id IS NULL THEN
    RAISE EXCEPTION 'No review found for task: %', p_task_id;
  END IF;

  -- Update current user's approval to blocked
  UPDATE review_approvals
  SET state = 'blocked', blocked_reason = p_blocked_reason, updated_at = now()
  WHERE review_id = v_review_id AND reviewer_id = v_actor_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User is not a reviewer for this task';
  END IF;

  -- Update review status to changes_requested
  UPDATE reviews SET status = 'changes_requested', updated_at = now() WHERE id = v_review_id;

  -- Hand the ball back to the internal side (the developer must act on the
  -- requested changes). This makes the change-request an actionable state.
  UPDATE tasks SET ball = 'internal', updated_at = now() WHERE id = p_task_id;

  -- Create audit log
  INSERT INTO task_events (org_id, space_id, task_id, actor_id, meeting_id, action, payload)
  VALUES (
    v_task.org_id,
    v_task.space_id,
    p_task_id,
    v_actor_id,
    p_meeting_id,
    'REVIEW_BLOCK',
    jsonb_build_object('blockedReason', p_blocked_reason)
  );

  -- Notify the developer who requested the review (exclude self-block).
  SELECT display_name INTO v_actor_name FROM profiles WHERE id = v_actor_id;

  IF v_requester_id IS NOT NULL AND v_requester_id <> v_actor_id THEN
    PERFORM _create_task_notification(
      v_task.org_id,
      v_task.space_id,
      v_requester_id,
      'ball_passed',
      format('review_block:%s:%s', v_review_id, v_requester_id),
      jsonb_build_object(
        'task_id', p_task_id,
        'task_title', v_task.title,
        'title', format('差し戻し: 「%s」', v_task.title),
        'message', format('修正依頼: %s', p_blocked_reason),
        'from_user_name', v_actor_name,
        'ball', 'internal'
      )
    );
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;


-- =============================================================================
-- 4. enforce_review_gate — block status→'done' with an unapproved review
-- =============================================================================
-- REVIEW_SPEC: a task with named reviewers must not complete until the review
-- is 'approved'. Enforced in the DB so it cannot be bypassed from any client.
-- Tasks without a review row are unaffected.
CREATE OR REPLACE FUNCTION enforce_review_gate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'done' AND OLD.status IS DISTINCT FROM 'done' THEN
    IF EXISTS (
      SELECT 1 FROM reviews
      WHERE task_id = NEW.id AND status <> 'approved'
    ) THEN
      RAISE EXCEPTION 'Cannot complete task: review is not approved'
        USING errcode = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_review_gate ON tasks;
CREATE TRIGGER trg_enforce_review_gate
  BEFORE UPDATE OF status ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION enforce_review_gate();


-- Grants (mirror existing RPC grants)
GRANT EXECUTE ON FUNCTION _create_task_notification TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_pass_ball TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_review_open TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_review_block TO authenticated;
