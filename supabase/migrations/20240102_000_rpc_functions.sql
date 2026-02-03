-- RPC Functions for TaskApp (API Spec v0.3)
-- These functions handle business logic with audit logging

-- =============================================================================
-- 4.1 rpc_pass_ball
-- Purpose: Change ball ownership and update task_owners in one transaction
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

  RETURN jsonb_build_object('ok', true);
END;
$$;


-- =============================================================================
-- 4.2 rpc_decide_considering
-- Purpose: Record a decision on a considering item with evidence tracking
-- =============================================================================
CREATE OR REPLACE FUNCTION rpc_decide_considering(
  p_task_id uuid,
  p_decision_text text,
  p_on_behalf_of text,
  p_evidence text,
  p_client_confirmed_by uuid DEFAULT NULL,
  p_meeting_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_task tasks%ROWTYPE;
  v_actor_id uuid;
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

  -- Validate: on_behalf_of='client' AND evidence!='meeting' requires client_confirmed_by
  IF p_on_behalf_of = 'client' AND p_evidence != 'meeting' AND p_client_confirmed_by IS NULL THEN
    RAISE EXCEPTION 'client_confirmed_by required for client decisions outside meetings';
  END IF;

  -- Create audit log (status is NOT changed per spec - state change is separate)
  INSERT INTO task_events (org_id, space_id, task_id, actor_id, meeting_id, action, payload)
  VALUES (
    v_task.org_id,
    v_task.space_id,
    p_task_id,
    v_actor_id,
    p_meeting_id,
    'CONSIDERING_DECIDE',
    jsonb_build_object(
      'decisionText', p_decision_text,
      'onBehalfOf', p_on_behalf_of,
      'evidence', p_evidence,
      'clientConfirmedBy', p_client_confirmed_by
    )
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;


-- =============================================================================
-- 4.3 rpc_set_spec_state
-- Purpose: Change spec task decision_state with audit logging
-- =============================================================================
CREATE OR REPLACE FUNCTION rpc_set_spec_state(
  p_task_id uuid,
  p_decision_state text,
  p_meeting_id uuid DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_task tasks%ROWTYPE;
  v_actor_id uuid;
  v_action text;
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

  -- Validate: only spec tasks allowed
  IF v_task.type != 'spec' THEN
    RAISE EXCEPTION 'Only spec tasks can have decision_state changed';
  END IF;

  -- Validate: spec_path must be set for decided/implemented
  IF p_decision_state IN ('decided', 'implemented') AND v_task.spec_path IS NULL THEN
    RAISE EXCEPTION 'spec_path required for decided/implemented state';
  END IF;

  -- Determine action type
  IF p_decision_state = 'decided' THEN
    v_action := 'SPEC_DECIDE';
  ELSIF p_decision_state = 'implemented' THEN
    v_action := 'SPEC_IMPLEMENT';
  ELSE
    v_action := 'SPEC_STATE_CHANGE';
  END IF;

  -- Update task
  UPDATE tasks
  SET decision_state = p_decision_state, updated_at = now()
  WHERE id = p_task_id;

  -- Create audit log
  INSERT INTO task_events (org_id, space_id, task_id, actor_id, meeting_id, action, payload)
  VALUES (
    v_task.org_id,
    v_task.space_id,
    p_task_id,
    v_actor_id,
    p_meeting_id,
    v_action,
    jsonb_build_object(
      'previousState', v_task.decision_state,
      'newState', p_decision_state,
      'note', p_note
    )
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;


-- =============================================================================
-- 4.4 rpc_review_open
-- Purpose: Create or update a review with reviewers
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
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Validate reviewers
  IF array_length(p_reviewer_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'At least one reviewer required';
  END IF;

  -- Get task
  SELECT * INTO v_task FROM tasks WHERE id = p_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found: %', p_task_id;
  END IF;

  -- Upsert review (task_id is UNIQUE)
  INSERT INTO reviews (org_id, space_id, task_id, status, created_by)
  VALUES (v_task.org_id, v_task.space_id, p_task_id, 'open', v_actor_id)
  ON CONFLICT (task_id) DO UPDATE SET status = 'open', updated_at = now()
  RETURNING id INTO v_review_id;

  -- Delete old approvals and insert new ones
  DELETE FROM review_approvals WHERE review_id = v_review_id;

  INSERT INTO review_approvals (org_id, review_id, reviewer_id, state)
  SELECT v_task.org_id, v_review_id, unnest(p_reviewer_ids), 'pending';

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

  RETURN jsonb_build_object('ok', true);
END;
$$;


-- =============================================================================
-- 4.5a rpc_review_approve
-- Purpose: Approve a review (current user)
-- =============================================================================
CREATE OR REPLACE FUNCTION rpc_review_approve(
  p_task_id uuid,
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
  v_all_approved boolean;
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

  -- Get review
  SELECT id INTO v_review_id FROM reviews WHERE task_id = p_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No review found for task: %', p_task_id;
  END IF;

  -- Update current user's approval
  UPDATE review_approvals
  SET state = 'approved', updated_at = now()
  WHERE review_id = v_review_id AND reviewer_id = v_actor_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User is not a reviewer for this task';
  END IF;

  -- Check if all reviewers approved
  SELECT NOT EXISTS (
    SELECT 1 FROM review_approvals
    WHERE review_id = v_review_id AND state != 'approved'
  ) INTO v_all_approved;

  -- Update review status if all approved
  IF v_all_approved THEN
    UPDATE reviews SET status = 'approved', updated_at = now() WHERE id = v_review_id;
  END IF;

  -- Create audit log
  INSERT INTO task_events (org_id, space_id, task_id, actor_id, meeting_id, action, payload)
  VALUES (
    v_task.org_id,
    v_task.space_id,
    p_task_id,
    v_actor_id,
    p_meeting_id,
    'REVIEW_APPROVE',
    jsonb_build_object('allApproved', v_all_approved)
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;


-- =============================================================================
-- 4.5b rpc_review_block
-- Purpose: Block/reject a review with reason
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

  -- Get review
  SELECT id INTO v_review_id FROM reviews WHERE task_id = p_task_id;
  IF NOT FOUND THEN
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

  RETURN jsonb_build_object('ok', true);
END;
$$;


-- =============================================================================
-- 4.6 rpc_meeting_start
-- Purpose: Start a meeting (planned -> in_progress)
-- =============================================================================
CREATE OR REPLACE FUNCTION rpc_meeting_start(
  p_meeting_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_meeting meetings%ROWTYPE;
  v_actor_id uuid;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Get meeting
  SELECT * INTO v_meeting FROM meetings WHERE id = p_meeting_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Meeting not found: %', p_meeting_id;
  END IF;

  -- Validate status
  IF v_meeting.status != 'planned' THEN
    RAISE EXCEPTION 'Meeting can only start from planned status, current: %', v_meeting.status;
  END IF;

  -- Update meeting
  UPDATE meetings
  SET status = 'in_progress', started_at = now(), updated_at = now()
  WHERE id = p_meeting_id;

  -- Create audit log (uses a dummy task event for meeting-level events)
  -- Note: In production, consider a separate meeting_events table
  INSERT INTO task_events (org_id, space_id, task_id, actor_id, meeting_id, action, payload)
  SELECT
    v_meeting.org_id,
    v_meeting.space_id,
    (SELECT id FROM tasks WHERE space_id = v_meeting.space_id LIMIT 1), -- dummy task
    v_actor_id,
    p_meeting_id,
    'MEETING_START',
    jsonb_build_object('meetingTitle', v_meeting.title)
  WHERE EXISTS (SELECT 1 FROM tasks WHERE space_id = v_meeting.space_id);

  RETURN jsonb_build_object('ok', true);
END;
$$;


-- =============================================================================
-- 4.7 rpc_meeting_end
-- Purpose: End a meeting with summary generation
-- =============================================================================
CREATE OR REPLACE FUNCTION rpc_meeting_end(
  p_meeting_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_meeting meetings%ROWTYPE;
  v_actor_id uuid;
  v_decided_count int;
  v_open_count int;
  v_ball_client_count int;
  v_summary_subject text;
  v_summary_body text;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Get meeting
  SELECT * INTO v_meeting FROM meetings WHERE id = p_meeting_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Meeting not found: %', p_meeting_id;
  END IF;

  -- Validate status
  IF v_meeting.status != 'in_progress' THEN
    RAISE EXCEPTION 'Meeting can only end from in_progress status, current: %', v_meeting.status;
  END IF;

  -- Count stats for this meeting's space
  SELECT COUNT(*) INTO v_decided_count
  FROM task_events te
  WHERE te.meeting_id = p_meeting_id AND te.action IN ('CONSIDERING_DECIDE', 'SPEC_DECIDE');

  SELECT COUNT(*) INTO v_open_count
  FROM tasks t
  WHERE t.space_id = v_meeting.space_id AND t.status = 'considering';

  SELECT COUNT(*) INTO v_ball_client_count
  FROM tasks t
  WHERE t.space_id = v_meeting.space_id AND t.ball = 'client';

  -- Generate summary
  v_summary_subject := format('【議事録】%s', v_meeting.title);
  v_summary_body := format(
    E'会議「%s」が終了しました。\n\n決定事項: %s件\n未決事項: %s件\nクライアント確認待ち: %s件',
    v_meeting.title,
    v_decided_count,
    v_open_count,
    v_ball_client_count
  );

  -- Update meeting
  UPDATE meetings
  SET
    status = 'ended',
    ended_at = now(),
    summary_subject = v_summary_subject,
    summary_body = v_summary_body,
    updated_at = now()
  WHERE id = p_meeting_id;

  -- Create audit log
  INSERT INTO task_events (org_id, space_id, task_id, actor_id, meeting_id, action, payload)
  SELECT
    v_meeting.org_id,
    v_meeting.space_id,
    (SELECT id FROM tasks WHERE space_id = v_meeting.space_id LIMIT 1),
    v_actor_id,
    p_meeting_id,
    'MEETING_END',
    jsonb_build_object(
      'decidedCount', v_decided_count,
      'openCount', v_open_count,
      'ballClientCount', v_ball_client_count
    )
  WHERE EXISTS (SELECT 1 FROM tasks WHERE space_id = v_meeting.space_id);

  RETURN jsonb_build_object(
    'ok', true,
    'summary_subject', v_summary_subject,
    'summary_body', v_summary_body,
    'counts', jsonb_build_object(
      'decided', v_decided_count,
      'open', v_open_count,
      'ball_client', v_ball_client_count
    )
  );
END;
$$;


-- =============================================================================
-- 4.8 rpc_generate_meeting_minutes
-- Purpose: Generate meeting minutes content for notifications
-- =============================================================================
CREATE OR REPLACE FUNCTION rpc_generate_meeting_minutes(
  p_meeting_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_meeting meetings%ROWTYPE;
  v_decided_count int;
  v_open_count int;
  v_ball_client_count int;
  v_nearest_due timestamptz;
  v_email_subject text;
  v_email_body text;
  v_in_app_title text;
  v_in_app_body text;
BEGIN
  -- Get meeting
  SELECT * INTO v_meeting FROM meetings WHERE id = p_meeting_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Meeting not found: %', p_meeting_id;
  END IF;

  -- Count decided items (from events linked to this meeting)
  SELECT COUNT(*) INTO v_decided_count
  FROM task_events te
  WHERE te.meeting_id = p_meeting_id AND te.action IN ('CONSIDERING_DECIDE', 'SPEC_DECIDE');

  -- Count open considering items
  SELECT COUNT(*) INTO v_open_count
  FROM tasks t
  WHERE t.space_id = v_meeting.space_id
    AND t.status = 'considering'
    AND t.ball = 'client';

  -- Count ball=client tasks
  SELECT COUNT(*) INTO v_ball_client_count
  FROM tasks t
  WHERE t.space_id = v_meeting.space_id AND t.ball = 'client';

  -- Get nearest due date for client tasks
  SELECT MIN(t.due_date) INTO v_nearest_due
  FROM tasks t
  WHERE t.space_id = v_meeting.space_id
    AND t.ball = 'client'
    AND t.due_date IS NOT NULL;

  -- Generate email content
  v_email_subject := format('【議事録】%s (%s)', v_meeting.title, to_char(v_meeting.held_at, 'YYYY/MM/DD'));
  v_email_body := format(
    E'%sの議事録をお送りします。\n\n' ||
    E'■ 決定事項: %s件\n' ||
    E'■ 未決事項（クライアント確認待ち）: %s件\n' ||
    E'■ クライアント対応タスク: %s件\n' ||
    E'%s\n\n' ||
    E'詳細はTaskAppでご確認ください。',
    v_meeting.title,
    v_decided_count,
    v_open_count,
    v_ball_client_count,
    CASE WHEN v_nearest_due IS NOT NULL
      THEN format('■ 最も近い期限: %s', to_char(v_nearest_due, 'YYYY/MM/DD'))
      ELSE ''
    END
  );

  -- Generate in-app content
  v_in_app_title := format('議事録: %s', v_meeting.title);
  v_in_app_body := format(
    '決定: %s件 / 未決: %s件 / 要対応: %s件',
    v_decided_count,
    v_open_count,
    v_ball_client_count
  );

  RETURN jsonb_build_object(
    'email_subject', v_email_subject,
    'email_body', v_email_body,
    'in_app_title', v_in_app_title,
    'in_app_body', v_in_app_body,
    'counts', jsonb_build_object(
      'decided', v_decided_count,
      'open', v_open_count,
      'ball_client', v_ball_client_count
    ),
    'nearest_due', v_nearest_due
  );
END;
$$;


-- =============================================================================
-- Grant execute permissions (adjust roles as needed)
-- =============================================================================
GRANT EXECUTE ON FUNCTION rpc_pass_ball TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_decide_considering TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_set_spec_state TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_review_open TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_review_approve TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_review_block TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_meeting_start TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_meeting_end TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_generate_meeting_minutes TO authenticated;
