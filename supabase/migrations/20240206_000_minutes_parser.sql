-- Migration: AT-005 - Meeting minutes parser for SPEC task creation
-- This creates an RPC function to parse meeting minutes and create spec tasks
--
-- Pattern: `- [ ] SPEC(/spec/FILE.md#anchor): title (期限: MM/DD, 担当: name)`
-- NOTE: Only unchecked checkboxes [ ] are processed. Checked [x] are ignored.
-- Marker: `<!--task:tXXX-->` appended to prevent duplicate creation

-- =============================================================================
-- 5.1 rpc_parse_meeting_minutes
-- Purpose: Parse markdown minutes and create type=spec tasks from SPEC lines
-- AT-005: Idempotent - lines with <!--task:XXX--> markers are skipped
-- =============================================================================
CREATE OR REPLACE FUNCTION rpc_parse_meeting_minutes(
  p_meeting_id uuid,
  p_minutes_md text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meeting meetings%ROWTYPE;
  v_actor_id uuid;
  v_line text;
  v_line_num int := 0;
  v_spec_match text[];
  v_spec_path text;
  v_title text;
  v_due_date date;
  v_new_task_id uuid;
  v_created_tasks jsonb := '[]'::jsonb;
  v_updated_minutes text := '';
  v_lines text[];
  v_has_marker boolean;
  v_task_marker text;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Get meeting with authorization check
  SELECT * INTO v_meeting FROM meetings WHERE id = p_meeting_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Meeting not found: %', p_meeting_id;
  END IF;

  -- Authorization: must be a participant or space member
  IF NOT EXISTS (
    SELECT 1 FROM meeting_participants mp
    WHERE mp.meeting_id = p_meeting_id AND mp.user_id = v_actor_id
  ) AND NOT EXISTS (
    SELECT 1 FROM space_memberships sm
    WHERE sm.space_id = v_meeting.space_id AND sm.user_id = v_actor_id
  ) THEN
    RAISE EXCEPTION 'Not authorized to parse minutes for this meeting';
  END IF;

  -- Split markdown into lines
  v_lines := string_to_array(p_minutes_md, E'\n');

  -- Process each line
  FOREACH v_line IN ARRAY v_lines LOOP
    v_line_num := v_line_num + 1;

    -- Check if line matches SPEC pattern with UNCHECKED checkbox only: - [ ] SPEC(...)
    -- NOTE: [x] and [X] are NOT matched - only empty [ ] checkboxes
    IF v_line ~ '^-\s*\[\s*\]\s*SPEC\([^)]+\):\s*.+$' THEN
      -- Check for existing marker (<!--task:XXX-->) - allows trailing whitespace
      v_has_marker := v_line ~ '<!--task:[^>]+-->\s*$';

      IF NOT v_has_marker THEN
        -- Extract spec_path from SPEC(...)
        v_spec_path := substring(v_line from 'SPEC\(([^)]+)\)');

        -- Strict spec_path validation: /spec/file#anchor (non-empty before and after #)
        IF v_spec_path IS NOT NULL
           AND v_spec_path ~ '^/spec/[^#\s]+#\S+$' THEN

          -- Extract title (everything after colon, before optional parentheses)
          v_title := substring(v_line from 'SPEC\([^)]+\):\s*([^（(]+)');
          IF v_title IS NOT NULL THEN
            v_title := trim(v_title);
          ELSE
            v_title := 'Untitled SPEC task';
          END IF;

          -- Extract due date if present (期限: MM/DD or YYYY/MM/DD)
          v_due_date := NULL;
          IF v_line ~ '期限:\s*\d+/\d+' THEN
            DECLARE
              v_date_str text;
              v_parts text[];
              v_year int;
              v_month int;
              v_day int;
            BEGIN
              v_date_str := substring(v_line from '期限:\s*(\d+/\d+(?:/\d+)?)');
              IF v_date_str IS NOT NULL THEN
                v_parts := string_to_array(v_date_str, '/');
                IF array_length(v_parts, 1) = 2 THEN
                  -- MM/DD format - assume current year
                  v_year := extract(year from CURRENT_DATE);
                  v_month := v_parts[1]::int;
                  v_day := v_parts[2]::int;
                  -- Validate month/day ranges
                  IF v_month >= 1 AND v_month <= 12 AND v_day >= 1 AND v_day <= 31 THEN
                    v_due_date := make_date(v_year, v_month, v_day);
                    -- If date is in past, use next year
                    IF v_due_date < CURRENT_DATE THEN
                      v_due_date := make_date(v_year + 1, v_month, v_day);
                    END IF;
                  END IF;
                ELSIF array_length(v_parts, 1) = 3 THEN
                  -- YYYY/MM/DD format
                  v_year := v_parts[1]::int;
                  v_month := v_parts[2]::int;
                  v_day := v_parts[3]::int;
                  -- Validate ranges
                  IF v_year >= 1900 AND v_year <= 2100
                     AND v_month >= 1 AND v_month <= 12
                     AND v_day >= 1 AND v_day <= 31 THEN
                    v_due_date := make_date(v_year, v_month, v_day);
                  END IF;
                END IF;
              END IF;
            EXCEPTION WHEN OTHERS THEN
              v_due_date := NULL;
            END;
          END IF;

          -- Create the spec task
          INSERT INTO tasks (
            org_id,
            space_id,
            title,
            status,
            ball,
            origin,
            type,
            spec_path,
            decision_state,
            due_date,
            created_by
          ) VALUES (
            v_meeting.org_id,
            v_meeting.space_id,
            v_title,
            'considering',  -- New spec tasks start as considering
            'client',       -- Spec decisions typically need client input
            'internal',     -- Created by internal (from meeting minutes)
            'spec',
            v_spec_path,
            'considering',  -- Initial decision state
            v_due_date,
            v_actor_id
          )
          RETURNING id INTO v_new_task_id;

          -- Create audit event
          INSERT INTO task_events (
            org_id,
            space_id,
            task_id,
            actor_id,
            meeting_id,
            action,
            payload
          ) VALUES (
            v_meeting.org_id,
            v_meeting.space_id,
            v_new_task_id,
            v_actor_id,
            p_meeting_id,
            'SPEC_CREATED',
            jsonb_build_object(
              'source', 'minutes_parser',
              'spec_path', v_spec_path,
              'line_number', v_line_num
            )
          );

          -- Add marker to line (preserve leading whitespace, trim trailing)
          v_task_marker := format(' <!--task:%s-->', v_new_task_id);
          v_line := rtrim(v_line) || v_task_marker;

          -- Track created task
          v_created_tasks := v_created_tasks || jsonb_build_object(
            'task_id', v_new_task_id,
            'title', v_title,
            'spec_path', v_spec_path,
            'due_date', v_due_date,
            'line_number', v_line_num
          );
        END IF;
      END IF;
    END IF;

    -- Append line to updated minutes
    IF v_line_num > 1 THEN
      v_updated_minutes := v_updated_minutes || E'\n';
    END IF;
    v_updated_minutes := v_updated_minutes || v_line;
  END LOOP;

  -- Update meeting with parsed minutes
  UPDATE meetings
  SET
    minutes_md = v_updated_minutes,
    updated_at = now()
  WHERE id = p_meeting_id;

  RETURN jsonb_build_object(
    'ok', true,
    'created_count', jsonb_array_length(v_created_tasks),
    'created_tasks', v_created_tasks,
    'updated_minutes', v_updated_minutes
  );
END;
$$;


-- =============================================================================
-- 5.2 rpc_get_minutes_preview
-- Purpose: Preview parsing without creating tasks (for UI preview)
-- Uses same validation as rpc_parse_meeting_minutes for consistency
-- =============================================================================
CREATE OR REPLACE FUNCTION rpc_get_minutes_preview(
  p_meeting_id uuid,
  p_minutes_md text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meeting meetings%ROWTYPE;
  v_actor_id uuid;
  v_line text;
  v_line_num int := 0;
  v_spec_path text;
  v_title text;
  v_new_lines jsonb := '[]'::jsonb;
  v_existing_lines jsonb := '[]'::jsonb;
  v_lines text[];
  v_has_marker boolean;
  v_existing_task_id text;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Get meeting with authorization check
  SELECT * INTO v_meeting FROM meetings WHERE id = p_meeting_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Meeting not found';
  END IF;

  -- Authorization check
  IF NOT EXISTS (
    SELECT 1 FROM meeting_participants mp
    WHERE mp.meeting_id = p_meeting_id AND mp.user_id = v_actor_id
  ) AND NOT EXISTS (
    SELECT 1 FROM space_memberships sm
    WHERE sm.space_id = v_meeting.space_id AND sm.user_id = v_actor_id
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Split markdown into lines
  v_lines := string_to_array(p_minutes_md, E'\n');

  -- Process each line
  FOREACH v_line IN ARRAY v_lines LOOP
    v_line_num := v_line_num + 1;

    -- Check if line matches SPEC pattern with UNCHECKED checkbox only
    IF v_line ~ '^-\s*\[\s*\]\s*SPEC\([^)]+\):\s*.+$' THEN
      -- Check for existing marker (allows trailing whitespace)
      v_has_marker := v_line ~ '<!--task:[^>]+-->\s*$';
      v_spec_path := substring(v_line from 'SPEC\(([^)]+)\)');

      -- Apply same strict validation as create function
      IF v_spec_path IS NOT NULL AND v_spec_path ~ '^/spec/[^#\s]+#\S+$' THEN
        v_title := substring(v_line from 'SPEC\([^)]+\):\s*([^（(]+)');
        IF v_title IS NOT NULL THEN
          v_title := trim(v_title);
        END IF;

        IF v_has_marker THEN
          -- Extract existing task ID
          v_existing_task_id := substring(v_line from '<!--task:([^>]+)-->');
          v_existing_lines := v_existing_lines || jsonb_build_object(
            'line_number', v_line_num,
            'spec_path', v_spec_path,
            'title', v_title,
            'task_id', v_existing_task_id
          );
        ELSE
          v_new_lines := v_new_lines || jsonb_build_object(
            'line_number', v_line_num,
            'spec_path', v_spec_path,
            'title', v_title
          );
        END IF;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'new_spec_count', jsonb_array_length(v_new_lines),
    'existing_spec_count', jsonb_array_length(v_existing_lines),
    'new_specs', v_new_lines,
    'existing_specs', v_existing_lines
  );
END;
$$;


-- Grant permissions
GRANT EXECUTE ON FUNCTION rpc_parse_meeting_minutes TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_get_minutes_preview TO authenticated;
