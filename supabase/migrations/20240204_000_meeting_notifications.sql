-- Migration: AT-003, AT-004 - Meeting end notifications with idempotency
-- This migration updates rpc_meeting_end to generate notifications

-- =============================================================================
-- 4.7 rpc_meeting_end (UPDATED)
-- Purpose: End a meeting with summary generation AND notification creation
-- AT-003: Idempotent notification generation (dedupe_key prevents duplicates)
-- AT-004: Proper content with ball=client priority and due_date sorting
-- =============================================================================
CREATE OR REPLACE FUNCTION rpc_meeting_end(
  p_meeting_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meeting meetings%ROWTYPE;
  v_actor_id uuid;
  v_decided_count int;
  v_open_count int;
  v_ball_client_count int;
  v_summary_subject text;
  v_summary_body text;
  v_dedupe_key text;
  v_participant record;
  v_task_list text;
  v_updated boolean;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Get meeting with lock to prevent race conditions
  SELECT * INTO v_meeting FROM meetings WHERE id = p_meeting_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Meeting not found: %', p_meeting_id;
  END IF;

  -- Authorization check: user must be a participant or space member
  IF NOT EXISTS (
    SELECT 1 FROM meeting_participants mp
    WHERE mp.meeting_id = p_meeting_id AND mp.user_id = v_actor_id
  ) AND NOT EXISTS (
    SELECT 1 FROM space_memberships sm
    WHERE sm.space_id = v_meeting.space_id AND sm.user_id = v_actor_id
  ) THEN
    RAISE EXCEPTION 'Not authorized to end this meeting';
  END IF;

  -- Validate status (allow re-ending for idempotency)
  IF v_meeting.status NOT IN ('in_progress', 'ended') THEN
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

  -- AT-004: Generate task list ordered by ball (client first), then due_date (null last)
  -- Use subquery with LIMIT to correctly limit rows before aggregation
  SELECT string_agg(task_line, E'\n') INTO v_task_list
  FROM (
    SELECT format('- %s%s',
      t.title,
      CASE WHEN t.due_date IS NOT NULL
        THEN format(' (期限: %s)', to_char(t.due_date, 'MM/DD'))
        ELSE ''
      END
    ) AS task_line
    FROM tasks t
    WHERE t.space_id = v_meeting.space_id
      AND (t.ball = 'client' OR t.status = 'considering')
    ORDER BY
      CASE WHEN t.ball = 'client' THEN 0 ELSE 1 END,
      CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END,
      t.due_date
    LIMIT 10
  ) sub;

  -- Generate summary
  v_summary_subject := format('【議事録】%s', v_meeting.title);
  v_summary_body := format(
    E'会議「%s」が終了しました。\n\n' ||
    E'決定事項: %s件\n' ||
    E'未決事項: %s件\n' ||
    E'クライアント確認待ち: %s件\n\n' ||
    E'【要対応タスク】\n%s',
    v_meeting.title,
    v_decided_count,
    v_open_count,
    v_ball_client_count,
    COALESCE(v_task_list, '(なし)')
  );

  -- Update meeting (only if not already ended)
  IF v_meeting.status = 'in_progress' THEN
    UPDATE meetings
    SET
      status = 'ended',
      ended_at = now(),
      summary_subject = v_summary_subject,
      summary_body = v_summary_body,
      updated_at = now()
    WHERE id = p_meeting_id;
  END IF;

  -- AT-003: Generate notifications for all participants (idempotent via dedupe_key)
  -- dedupe_key format: meeting_end:{meeting_id}
  v_dedupe_key := format('meeting_end:%s', p_meeting_id);

  -- Insert in_app notifications for all meeting participants
  FOR v_participant IN
    SELECT mp.user_id
    FROM meeting_participants mp
    WHERE mp.meeting_id = p_meeting_id
  LOOP
    INSERT INTO notifications (
      org_id,
      space_id,
      to_user_id,
      channel,
      type,
      dedupe_key,
      payload
    ) VALUES (
      v_meeting.org_id,
      v_meeting.space_id,
      v_participant.user_id,
      'in_app',
      'meeting_ended',
      v_dedupe_key,
      jsonb_build_object(
        'title', v_summary_subject,
        'message', format('決定: %s件 / 未決: %s件 / 要対応: %s件', v_decided_count, v_open_count, v_ball_client_count),
        'meeting_id', p_meeting_id,
        'meeting_title', v_meeting.title,
        'summary_subject', v_summary_subject,
        'summary_body', v_summary_body,
        'decided_count', v_decided_count,
        'open_count', v_open_count,
        'ball_client_count', v_ball_client_count
      )
    )
    ON CONFLICT (to_user_id, channel, dedupe_key) DO NOTHING;
  END LOOP;

  -- Also notify task owners of client-ball tasks who weren't in the meeting
  INSERT INTO notifications (
    org_id,
    space_id,
    to_user_id,
    channel,
    type,
    dedupe_key,
    payload
  )
  SELECT DISTINCT
    v_meeting.org_id,
    v_meeting.space_id,
    tow.user_id,
    'in_app',
    'meeting_ended',
    v_dedupe_key,
    jsonb_build_object(
      'title', v_summary_subject,
      'message', format('決定: %s件 / 未決: %s件 / 要対応: %s件', v_decided_count, v_open_count, v_ball_client_count),
      'meeting_id', p_meeting_id,
      'meeting_title', v_meeting.title,
      'summary_subject', v_summary_subject,
      'summary_body', v_summary_body,
      'decided_count', v_decided_count,
      'open_count', v_open_count,
      'ball_client_count', v_ball_client_count
    )
  FROM task_owners tow
  JOIN tasks t ON t.id = tow.task_id
  WHERE t.space_id = v_meeting.space_id
    AND t.ball = 'client'
    AND NOT EXISTS (
      SELECT 1 FROM meeting_participants mp
      WHERE mp.meeting_id = p_meeting_id AND mp.user_id = tow.user_id
    )
  ON CONFLICT (to_user_id, channel, dedupe_key) DO NOTHING;

  -- Create audit log (only if not already ended)
  IF v_meeting.status = 'in_progress' THEN
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
  END IF;

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
-- 4.8 rpc_generate_meeting_minutes (UPDATED)
-- Purpose: Generate meeting minutes with AT-004 compliant sorting
-- =============================================================================
CREATE OR REPLACE FUNCTION rpc_generate_meeting_minutes(
  p_meeting_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meeting meetings%ROWTYPE;
  v_actor_id uuid;
  v_decided_count int;
  v_open_count int;
  v_ball_client_count int;
  v_nearest_due timestamptz;
  v_email_subject text;
  v_email_body text;
  v_in_app_title text;
  v_in_app_body text;
  v_task_list text;
BEGIN
  v_actor_id := auth.uid();

  -- Authorization check FIRST to prevent meeting ID enumeration
  -- Service-role calls (v_actor_id IS NULL) bypass this check
  -- STRICT: Only meeting participants can access (no space membership fallback)
  IF v_actor_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM meeting_participants mp
      WHERE mp.meeting_id = p_meeting_id AND mp.user_id = v_actor_id
    ) THEN
      -- Return generic error regardless of whether meeting exists
      RAISE EXCEPTION 'Not authorized';
    END IF;
  END IF;

  -- Get meeting (only after authorization confirmed for user calls)
  SELECT * INTO v_meeting FROM meetings WHERE id = p_meeting_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Meeting not found';
  END IF;

  -- Count decided items (from events linked to this meeting)
  SELECT COUNT(*) INTO v_decided_count
  FROM task_events te
  WHERE te.meeting_id = p_meeting_id AND te.action IN ('CONSIDERING_DECIDE', 'SPEC_DECIDE');

  -- Count open considering items (ball=client prioritized in output)
  SELECT COUNT(*) INTO v_open_count
  FROM tasks t
  WHERE t.space_id = v_meeting.space_id
    AND t.status = 'considering';

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

  -- AT-004: Generate task list ordered by ball (client first), then due_date (null last)
  -- Use subquery with LIMIT to correctly limit rows before aggregation
  SELECT string_agg(task_line, E'\n') INTO v_task_list
  FROM (
    SELECT format('- %s%s%s',
      CASE WHEN t.ball = 'client' THEN '[要対応] ' ELSE '' END,
      t.title,
      CASE WHEN t.due_date IS NOT NULL
        THEN format(' (期限: %s)', to_char(t.due_date, 'MM/DD'))
        ELSE ''
      END
    ) AS task_line
    FROM tasks t
    WHERE t.space_id = v_meeting.space_id
      AND (t.ball = 'client' OR t.status = 'considering')
    ORDER BY
      CASE WHEN t.ball = 'client' THEN 0 ELSE 1 END,
      CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END,
      t.due_date
    LIMIT 20
  ) sub;

  -- Generate email content
  v_email_subject := format('【議事録】%s (%s)', v_meeting.title, to_char(v_meeting.held_at, 'YYYY/MM/DD'));
  v_email_body := format(
    E'%sの議事録をお送りします。\n\n' ||
    E'■ 決定事項: %s件\n' ||
    E'■ 未決事項: %s件\n' ||
    E'■ クライアント対応タスク: %s件\n' ||
    E'%s\n\n' ||
    E'【タスク一覧】\n%s\n\n' ||
    E'詳細はTaskAppでご確認ください。',
    v_meeting.title,
    v_decided_count,
    v_open_count,
    v_ball_client_count,
    CASE WHEN v_nearest_due IS NOT NULL
      THEN format('■ 最も近い期限: %s', to_char(v_nearest_due, 'YYYY/MM/DD'))
      ELSE ''
    END,
    COALESCE(v_task_list, '(なし)')
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


-- Grant permissions
GRANT EXECUTE ON FUNCTION rpc_meeting_end TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_generate_meeting_minutes TO authenticated;
