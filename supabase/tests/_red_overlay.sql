-- RED overlay: restore the PRE-migration behaviour so the test can prove it
-- actually catches the gaps (no notifications, no ball return, no gate).
-- Apply this, run the test (expect FAIL T1), then `supabase db reset` to restore.

DROP TRIGGER IF EXISTS trg_enforce_review_gate ON tasks;

-- old rpc_pass_ball (no notification generation)
CREATE OR REPLACE FUNCTION rpc_pass_ball(
  p_task_id uuid, p_ball text,
  p_client_owner_ids uuid[] DEFAULT '{}', p_internal_owner_ids uuid[] DEFAULT '{}',
  p_reason text DEFAULT NULL, p_meeting_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_task tasks%ROWTYPE; v_actor_id uuid; v_org_id uuid; v_space_id uuid;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_task FROM tasks WHERE id = p_task_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Task not found: %', p_task_id; END IF;
  v_org_id := v_task.org_id; v_space_id := v_task.space_id;
  IF p_ball = 'client' AND array_length(p_client_owner_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Client owner required when ball=client'; END IF;
  UPDATE tasks SET ball = p_ball, updated_at = now() WHERE id = p_task_id;
  DELETE FROM task_owners WHERE task_id = p_task_id;
  IF array_length(p_client_owner_ids, 1) > 0 THEN
    INSERT INTO task_owners (org_id, space_id, task_id, side, user_id)
    SELECT v_org_id, v_space_id, p_task_id, 'client', unnest(p_client_owner_ids); END IF;
  IF array_length(p_internal_owner_ids, 1) > 0 THEN
    INSERT INTO task_owners (org_id, space_id, task_id, side, user_id)
    SELECT v_org_id, v_space_id, p_task_id, 'internal', unnest(p_internal_owner_ids); END IF;
  INSERT INTO task_events (org_id, space_id, task_id, actor_id, meeting_id, action, payload)
  VALUES (v_org_id, v_space_id, p_task_id, v_actor_id, p_meeting_id, 'PASS_BALL',
    jsonb_build_object('ball', p_ball, 'clientOwnerIds', p_client_owner_ids,
      'internalOwnerIds', p_internal_owner_ids, 'reason', p_reason));
  RETURN jsonb_build_object('ok', true);
END; $$;

-- old rpc_review_block (no ball return, no notification)
CREATE OR REPLACE FUNCTION rpc_review_block(
  p_task_id uuid, p_blocked_reason text, p_meeting_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_task tasks%ROWTYPE; v_actor_id uuid; v_review_id uuid;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_task FROM tasks WHERE id = p_task_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Task not found: %', p_task_id; END IF;
  SELECT id INTO v_review_id FROM reviews WHERE task_id = p_task_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'No review found for task: %', p_task_id; END IF;
  UPDATE review_approvals SET state = 'blocked', blocked_reason = p_blocked_reason, updated_at = now()
  WHERE review_id = v_review_id AND reviewer_id = v_actor_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'User is not a reviewer for this task'; END IF;
  UPDATE reviews SET status = 'changes_requested', updated_at = now() WHERE id = v_review_id;
  INSERT INTO task_events (org_id, space_id, task_id, actor_id, meeting_id, action, payload)
  VALUES (v_task.org_id, v_task.space_id, p_task_id, v_actor_id, p_meeting_id, 'REVIEW_BLOCK',
    jsonb_build_object('blockedReason', p_blocked_reason));
  RETURN jsonb_build_object('ok', true);
END; $$;
