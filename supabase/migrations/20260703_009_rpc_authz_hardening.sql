-- =============================================================================
-- RPC Authorization Hardening — 越境IDOR 対策（監査B2）
-- =============================================================================
-- Problem (audit B2):
--   以下の SECURITY DEFINER RPC は RLS をバイパスするにもかかわらず、
--   `auth.uid() IS NOT NULL`（ログイン済みか）しか確認しておらず、対象行
--   (task / review / meeting) が呼出元の org/space に属するかを検証していない。
--   → 攻撃者が他組織の task_id / meeting_id を渡すと操作できる越境 IDOR。
--
-- Fix (このマイグレーション):
--   各 RPC の冒頭（対象行の取得直後・ミューテーション前）に、適用済みヘルパ
--   `public.app_can_access_space(p_space uuid, p_org uuid)` による認可ガードを
--   追加する（内部メンバー=org内可 / client・vendor=自スペースのみ可）。
--   アクセス不可なら例外を送出し、以降のロジックには進ませない。
--   これは 20260218_000_fix_review_open_approvals.sql（rpc_review_open に
--   メンバーシップ検証を後付けした修正）と同じ設計方針。
--
--   併せて監査B2の付随指摘に対応し、全対象関数へ `set search_path = public`
--   を付与（search_path 固定）し、末尾で `anon` からの EXECUTE を剥奪する
--   （`authenticated` への grant は従来どおり維持）。
--
-- Scope / 非破壊性:
--   関数の再定義（create or replace）のみ。テーブル/データ/シグネチャ/戻り値/
--   本来のロジックは一切変更しない。各関数は「現行の最新定義」を土台に、
--   冒頭の認可ガードと search_path 固定だけを追加している。
--
--   ★ 各関数の「最新定義」の出所（このファイルはそれを土台にしている）:
--     - rpc_pass_ball      : 20260703_000_collab_notifications.sql（通知付き版）
--     - rpc_review_block   : 20260703_000_collab_notifications.sql（差し戻し+通知版）
--     - rpc_review_approve : 20240102_000_rpc_functions.sql（以降未改訂）
--     - rpc_meeting_start  : 20240102_000_rpc_functions.sql（以降未改訂）
--     - rpc_set_spec_state : 20260224_000_spec_wiki_integration.sql（wiki 連携版）
--
-- Anchor（各 RPC が認可判定に使う space/org の出所）:
--     - rpc_pass_ball      : 対象 task の space_id / org_id
--     - rpc_review_approve : 対象 review の space_id / org_id
--     - rpc_review_block   : 対象 review の space_id / org_id
--     - rpc_meeting_start  : 対象 meeting の space_id / org_id
--     - rpc_set_spec_state : 対象 task の space_id / org_id
--
-- 既存の部分的認可との関係:
--     - rpc_review_open は 20260218 で既にスペース・メンバーシップ検証済みのため
--       本ファイルの対象外（重複回避）。
--     - rpc_review_approve / rpc_review_block は既に「呼出元が reviewer か」
--       （reviewer_id = auth.uid() の UPDATE 行数）を検証している。本ファイルは
--       それを残したまま、より広い＆前段の「スペース所属」ガードを追加する
--       （多層防御。reviewer チェックはミューテーション後に効くため、越境判定は
--        前段のスペースガードで先に弾く）。
-- =============================================================================


-- =============================================================================
-- 1. rpc_pass_ball  （土台: 20260703_000_collab_notifications.sql）
--    Anchor: 対象 task の space_id / org_id
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
SET search_path = public
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

  -- 認可ガード（監査B2 / 越境IDOR対策）: 呼出元が対象 task の space/org に
  -- アクセス可能か検証する。ミューテーション前に実行し、越境操作を弾く。
  IF NOT public.app_can_access_space(v_task.space_id, v_task.org_id) THEN
    RAISE EXCEPTION 'Not authorized to access this task';
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
-- 2. rpc_review_approve  （土台: 20240102_000_rpc_functions.sql）
--    Anchor: 対象 review の space_id / org_id
--    既存の reviewer_id チェックは維持し、前段にスペースガードを追加。
-- =============================================================================
CREATE OR REPLACE FUNCTION rpc_review_approve(
  p_task_id uuid,
  p_meeting_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task tasks%ROWTYPE;
  v_actor_id uuid;
  v_review_id uuid;
  v_review_space_id uuid;
  v_review_org_id uuid;
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

  -- Get review (+ space/org for the authorization anchor)
  SELECT id, space_id, org_id
  INTO v_review_id, v_review_space_id, v_review_org_id
  FROM reviews WHERE task_id = p_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No review found for task: %', p_task_id;
  END IF;

  -- 認可ガード（監査B2 / 越境IDOR対策）: 呼出元が対象 review の space/org に
  -- アクセス可能か検証する。既存の reviewer_id チェックより前段の多層防御。
  IF NOT public.app_can_access_space(v_review_space_id, v_review_org_id) THEN
    RAISE EXCEPTION 'Not authorized to access this review';
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
-- 3. rpc_review_block  （土台: 20260703_000_collab_notifications.sql）
--    Anchor: 対象 review の space_id / org_id
--    既存の reviewer_id チェックは維持し、前段にスペースガードを追加。
-- =============================================================================
CREATE OR REPLACE FUNCTION rpc_review_block(
  p_task_id uuid,
  p_blocked_reason text,
  p_meeting_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task tasks%ROWTYPE;
  v_actor_id uuid;
  v_review_id uuid;
  v_review_space_id uuid;
  v_review_org_id uuid;
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

  -- Get review (+ requester for the ball hand-back notification, + space/org anchor)
  SELECT id, created_by, space_id, org_id
  INTO v_review_id, v_requester_id, v_review_space_id, v_review_org_id
  FROM reviews WHERE task_id = p_task_id;
  IF v_review_id IS NULL THEN
    RAISE EXCEPTION 'No review found for task: %', p_task_id;
  END IF;

  -- 認可ガード（監査B2 / 越境IDOR対策）: 呼出元が対象 review の space/org に
  -- アクセス可能か検証する。既存の reviewer_id チェックより前段の多層防御。
  IF NOT public.app_can_access_space(v_review_space_id, v_review_org_id) THEN
    RAISE EXCEPTION 'Not authorized to access this review';
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
-- 4. rpc_meeting_start  （土台: 20240102_000_rpc_functions.sql）
--    Anchor: 対象 meeting の space_id / org_id
-- =============================================================================
CREATE OR REPLACE FUNCTION rpc_meeting_start(
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

  -- 認可ガード（監査B2 / 越境IDOR対策）: 呼出元が対象 meeting の space/org に
  -- アクセス可能か検証する。ミューテーション前に実行し、越境操作を弾く。
  IF NOT public.app_can_access_space(v_meeting.space_id, v_meeting.org_id) THEN
    RAISE EXCEPTION 'Not authorized to access this meeting';
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
-- 5. rpc_set_spec_state  （土台: 20260224_000_spec_wiki_integration.sql）
--    Anchor: 対象 task の space_id / org_id
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
SET search_path = public
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

  -- 認可ガード（監査B2 / 越境IDOR対策）: 呼出元が対象 task の space/org に
  -- アクセス可能か検証する。ミューテーション前に実行し、越境操作を弾く。
  IF NOT public.app_can_access_space(v_task.space_id, v_task.org_id) THEN
    RAISE EXCEPTION 'Not authorized to access this task';
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


-- =============================================================================
-- Grants: anon から EXECUTE を剥奪し、authenticated への grant を明示維持。
--   （create or replace は既存の grant を保持するが、search_path 変更等の後でも
--     権限境界が確実になるよう明示的に再宣言する。冪等。）
-- =============================================================================
REVOKE EXECUTE ON FUNCTION rpc_pass_ball(uuid, text, uuid[], uuid[], text, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION rpc_review_approve(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION rpc_review_block(uuid, text, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION rpc_meeting_start(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION rpc_set_spec_state(uuid, text, uuid, text) FROM anon;

GRANT EXECUTE ON FUNCTION rpc_pass_ball(uuid, text, uuid[], uuid[], text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_review_approve(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_review_block(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_meeting_start(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_set_spec_state(uuid, text, uuid, text) TO authenticated;


-- =============================================================================
-- 検証（適用後の想定手動確認 / なりすまし検証）:
--   A) search_path 固定と SECURITY DEFINER が維持されていること:
--        select proname, prosecdef, proconfig
--          from pg_proc
--         where proname in
--           ('rpc_pass_ball','rpc_review_approve','rpc_review_block',
--            'rpc_meeting_start','rpc_set_spec_state');
--      → prosecdef=true、proconfig に search_path=public を含むこと。
--   B) anon から EXECUTE が剥奪されていること:
--        select has_function_privilege('anon',
--          'rpc_meeting_start(uuid)', 'EXECUTE');  -- → false
--        select has_function_privilege('authenticated',
--          'rpc_meeting_start(uuid)', 'EXECUTE');  -- → true
--   C) 越境IDOR が塞がれていること（なりすまし）:
--      - org A のユーザーとしてログイン（JWT）した状態で、org B に属する
--        task_id / meeting_id を各 RPC に渡す。
--      - 期待: 'Not authorized to access this <resource>' 例外で失敗し、
--        対象行が一切変更されないこと（tasks.ball / reviews.status /
--        meetings.status / decision_state が不変、task_events も追記されない）。
--      - 同一 space に属する正規ユーザーからの呼び出しは従来どおり成功すること
--        （回帰確認）。client/vendor は自スペースのみ可、内部メンバーは org 内可。
--
-- ロールバック（不可逆な変更は無い。関数の再定義のみ）:
--   * 認可ガード追加前の各定義（上記「最新定義の出所」の各ファイル）を
--     再度 create or replace で流し直せば元に戻る。
--   * grant/revoke を戻す場合:
--       GRANT EXECUTE ON FUNCTION <fn>(<args>) TO anon;  -- 元が anon 許可だった場合のみ
--     （元々 anon への明示 grant は無いため、通常は不要。authenticated の
--       grant は維持のままでよい。）
--   * データ変更・DDL 変更は無いため、データ側のロールバックは不要。
-- =============================================================================
