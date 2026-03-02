-- =============================================================================
-- Migration: spec_path → wiki_page_id 統合
-- Purpose: 仕様タスクをWikiページベースに移行
-- =============================================================================

-- 1. Add wiki_page_id column to tasks
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS wiki_page_id uuid REFERENCES wiki_pages(id) ON DELETE RESTRICT;

-- 2. Index for wiki_page_id lookups
CREATE INDEX IF NOT EXISTS tasks_wiki_page_id_idx ON tasks(wiki_page_id) WHERE wiki_page_id IS NOT NULL;

-- 3. Drop old CHECK constraint and create new one
-- Old: spec_path IS NOT NULL AND spec_path LIKE '/spec/%#%' AND decision_state IS NOT NULL
-- New: wiki_page_id IS NOT NULL AND decision_state IS NOT NULL (spec_path は後方互換で残す)
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_spec_required_chk;

ALTER TABLE tasks ADD CONSTRAINT tasks_spec_required_chk CHECK (
  type <> 'spec'
  OR (
    (wiki_page_id IS NOT NULL OR nullif(btrim(spec_path), '') IS NOT NULL)
    AND decision_state IS NOT NULL
  )
);

-- 4. Update rpc_set_spec_state to check wiki_page_id instead of spec_path
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
  v_wiki_body text;
  v_wiki_title text;
  v_task_title text;
  v_append_text text;
  v_new_body text;
  v_blocks jsonb;
  v_new_block jsonb;
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

  -- Validate: wiki_page_id or spec_path must be set for decided/implemented
  IF p_decision_state IN ('decided', 'implemented')
     AND v_task.wiki_page_id IS NULL
     AND v_task.spec_path IS NULL THEN
    RAISE EXCEPTION 'wiki_page_id or spec_path required for decided/implemented state';
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

  -- Auto-append to wiki page if wiki_page_id is set
  IF v_task.wiki_page_id IS NOT NULL AND p_decision_state IN ('decided', 'implemented') THEN
    -- Ownership validation: wiki page must belong to the same org and space
    SELECT body, title INTO v_wiki_body, v_wiki_title
    FROM wiki_pages
    WHERE id = v_task.wiki_page_id
      AND org_id = v_task.org_id
      AND space_id = v_task.space_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Wiki page not found or does not belong to the same org/space as the task';
    END IF;

    v_task_title := v_task.title;

    -- Build a BlockNote paragraph block for the decision log
    IF p_decision_state = 'decided' THEN
      v_append_text := '✅ 決定: ' || v_task_title || ' (' || to_char(now() AT TIME ZONE 'Asia/Tokyo', 'YYYY/MM/DD') || ')';
    ELSE
      v_append_text := '🚀 実装済み: ' || v_task_title || ' (' || to_char(now() AT TIME ZONE 'Asia/Tokyo', 'YYYY/MM/DD') || ')';
    END IF;

    -- Create a new BlockNote paragraph block
    v_new_block := jsonb_build_object(
      'id', gen_random_uuid()::text,
      'type', 'paragraph',
      'props', jsonb_build_object(
        'textColor', 'default',
        'backgroundColor', 'default',
        'textAlignment', 'left'
      ),
      'content', jsonb_build_array(
        jsonb_build_object(
          'type', 'text',
          'text', v_append_text,
          'styles', '{}'::jsonb
        )
      ),
      'children', '[]'::jsonb
    );

    -- Parse existing body as JSON array and append new block
    BEGIN
      v_blocks := v_wiki_body::jsonb;
      IF jsonb_typeof(v_blocks) = 'array' THEN
        v_new_body := (v_blocks || jsonb_build_array(v_new_block))::text;
      ELSE
        -- Non-array body: wrap existing content as-is, then append new block
        v_new_body := jsonb_build_array(v_blocks, v_new_block)::text;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- If body is not valid JSON, create new array with new block only
      v_new_body := jsonb_build_array(v_new_block)::text;
    END;

    -- Save version before update
    INSERT INTO wiki_page_versions (org_id, page_id, title, body, created_by)
    SELECT org_id, id, title, body, v_actor_id
    FROM wiki_pages
    WHERE id = v_task.wiki_page_id;

    -- Update wiki page body
    UPDATE wiki_pages
    SET body = v_new_body, updated_by = v_actor_id, updated_at = now()
    WHERE id = v_task.wiki_page_id;
  END IF;

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
      'note', p_note,
      'wiki_page_id', v_task.wiki_page_id
    )
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;
