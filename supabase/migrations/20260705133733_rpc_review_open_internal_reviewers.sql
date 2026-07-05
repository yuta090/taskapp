-- =============================================================================
-- rpc_review_open: レビュアーを社内ロール（admin / editor）に限定する
--
-- 問題: 20260218_000 はレビュアーが「スペースのメンバーであること」しか検証して
--       おらず、client / vendor ロールのメンバーもレビュアーに指定できた。
--       社内承認（REVIEW_SPEC）はレビュアー=社内メンバーが前提で、UI
--       （TaskReviewSection）は internal メンバーに絞っているが、MCP や直接の
--       RPC 呼び出しでは制限を迂回できた。
-- 解決: レビュアー検証を role IN ('admin','editor') に強化する。
--       本文は 20260218_000_fix_review_open_approvals.sql（承認保持版）を土台に
--       し、レビュアー検証のみ変更。
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

  -- Security: 社内承認のレビュアーは社内ロール（admin / editor）のみ。
  -- client / vendor ロールのメンバーは指定不可（クライアント確認はボールで行う）。
  IF EXISTS (
    SELECT rid FROM unnest(p_reviewer_ids) AS rid
    WHERE rid NOT IN (
      SELECT user_id FROM space_memberships
      WHERE space_id = v_task.space_id
        AND role IN ('admin', 'editor')
    )
  ) THEN
    RAISE EXCEPTION 'One or more reviewer IDs are not internal members (admin/editor) of this space';
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

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION rpc_review_open(uuid, uuid[], uuid) FROM anon;
GRANT EXECUTE ON FUNCTION rpc_review_open(uuid, uuid[], uuid) TO authenticated;
