-- CLI / API からも「決定にする」ができるようにする
--
-- 画面には「決定にする」があるのに、CLI・AI秘書には相当する道具が無かった。
-- rpc_set_spec_state が `auth.uid()` を見ているため、鍵で動く道具（service_role・
-- 利用者としてのログインを持たない）からは呼べない。
--
-- このリポジトリの決まりどおり、本体を `_impl`（実行者を引数で受け取る）に出し、
-- 画面用（`auth.uid()` を渡す）と道具用（`_as`・実行者を明示）の2つで包む。
-- 20260912134823_mcp_rpc_as.sql が rpc_pass_ball / rpc_review_* で使っている形と同じ。
--
-- 本体の中身は 20260914072915 の定義をそのまま写している。変えたのは実行者の取り方
-- （`auth.uid()` → `p_actor`）の1か所だけで、認可・検証・控えの作り方・決定行・
-- task_events は一切変えていない。

CREATE OR REPLACE FUNCTION public._set_spec_state_impl(
  p_actor uuid,
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
  v_label text;
  v_new_body text;
  v_blocks jsonb;
  v_new_block jsonb;
  v_task_href text;
BEGIN
  v_actor_id := p_actor;
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_task FROM tasks WHERE id = p_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found: %', p_task_id;
  END IF;

  -- 認可ガード（監査B2 / 越境IDOR対策）
  -- 権限の確認も**実行者**で行う。app_can_write_space は中で auth.uid() を見るので、
  -- 鍵で動く道具（_as 経由・ログイン中の利用者がいない）から呼ぶと必ず落ちる。
  -- 判定の中身は app_can_write_space と同じ（20260912134823 の節1）。
  IF NOT public._actor_can_write_space(v_actor_id, v_task.space_id, v_task.org_id) THEN
    RAISE EXCEPTION 'Not authorized to access this task';
  END IF;

  IF v_task.type != 'spec' THEN
    RAISE EXCEPTION 'Only spec tasks can have decision_state changed';
  END IF;

  IF p_decision_state IN ('decided', 'implemented')
     AND v_task.wiki_page_id IS NULL
     AND v_task.spec_path IS NULL THEN
    RAISE EXCEPTION 'wiki_page_id or spec_path required for decided/implemented state';
  END IF;

  IF p_decision_state = 'decided' THEN
    v_action := 'SPEC_DECIDE';
  ELSIF p_decision_state = 'implemented' THEN
    v_action := 'SPEC_IMPLEMENT';
  ELSE
    v_action := 'SPEC_STATE_CHANGE';
  END IF;

  UPDATE tasks
  SET decision_state = p_decision_state, updated_at = now()
  WHERE id = p_task_id;

  IF v_task.wiki_page_id IS NOT NULL AND p_decision_state IN ('decided', 'implemented') THEN
    -- (a) 読んでから書くまでの間に他の保存が入らないよう、この行を押さえてから読む。
    -- 押さえないと、同時に2つの札を確定したときに片方の決定行が消える。
    SELECT body, title INTO v_wiki_body, v_wiki_title
    FROM wiki_pages
    WHERE id = v_task.wiki_page_id
      AND org_id = v_task.org_id
      AND space_id = v_task.space_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Wiki page not found or does not belong to the same org/space as the task';
    END IF;

    v_task_title := v_task.title;
    v_task_href := '/' || v_task.org_id::text || '/project/' || v_task.space_id::text
                   || '?task=' || p_task_id::text;

    IF p_decision_state = 'decided' THEN
      v_label := '決定: ';
    ELSE
      v_label := '実装済み: ';
    END IF;

    -- (c)(d) 「決定: 」＋札へのリンク（題名）＋「（日付）」。リンクを押すとその札に飛べる。
    -- BlockNote の link インラインは content に文字を持つ（appLinks.ts が作る形と同じ）。
    v_new_block := jsonb_build_object(
      'id', gen_random_uuid()::text,
      'type', 'paragraph',
      'props', jsonb_build_object(
        'textColor', 'default',
        'backgroundColor', 'default',
        'textAlignment', 'left'
      ),
      'content', jsonb_build_array(
        jsonb_build_object('type', 'text', 'text', v_label, 'styles', '{}'::jsonb),
        jsonb_build_object(
          'type', 'link',
          'href', v_task_href,
          'content', jsonb_build_array(
            jsonb_build_object('type', 'text', 'text', v_task_title, 'styles', '{}'::jsonb)
          )
        ),
        jsonb_build_object(
          'type', 'text',
          'text', ' (' || to_char(now() AT TIME ZONE 'Asia/Tokyo', 'YYYY/MM/DD') || ')',
          'styles', '{}'::jsonb
        )
      ),
      'children', '[]'::jsonb
    );

    BEGIN
      v_blocks := v_wiki_body::jsonb;
      IF jsonb_typeof(v_blocks) = 'array' THEN
        v_new_body := (v_blocks || jsonb_build_array(v_new_block))::text;
      ELSE
        v_new_body := jsonb_build_array(v_blocks, v_new_block)::text;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_new_body := jsonb_build_array(v_new_block)::text;
    END;

    -- (b) 決定行を書き足す**前**の本文を、名札付きで控えにする＝これが「確定時点の内容」
    INSERT INTO wiki_page_versions (org_id, page_id, title, body, created_by, kind, task_id)
    VALUES (
      v_task.org_id,
      v_task.wiki_page_id,
      v_wiki_title,
      v_wiki_body,
      v_actor_id,
      p_decision_state,
      p_task_id
    );

    UPDATE wiki_pages
    SET body = v_new_body, updated_by = v_actor_id, updated_at = now()
    WHERE id = v_task.wiki_page_id;
  END IF;

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
END;$$;

-- 本体は誰にも直接は呼ばせない（下の2つの包みだけが呼ぶ）
REVOKE ALL ON FUNCTION public._set_spec_state_impl(uuid, uuid, text, uuid, text)
  FROM public, anon, authenticated;

-- 画面用。ログイン中の利用者が実行者になる
CREATE OR REPLACE FUNCTION public.rpc_set_spec_state(
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
BEGIN
  RETURN public._set_spec_state_impl(auth.uid(), p_task_id, p_decision_state, p_meeting_id, p_note);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_set_spec_state(uuid, text, uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_set_spec_state(uuid, text, uuid, text)
  TO authenticated, service_role;

-- 道具用（CLI / API / AI秘書）。誰が押したかを呼び出し側が明示する。
-- 鍵に紐づく利用者を渡すので、監査（task_events.actor_id）が画面と同じ意味になる。
CREATE OR REPLACE FUNCTION public.rpc_set_spec_state_as(
  p_actor uuid,
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
BEGIN
  RETURN public._set_spec_state_impl(p_actor, p_task_id, p_decision_state, p_meeting_id, p_note);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_set_spec_state_as(uuid, uuid, text, uuid, text)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_set_spec_state_as(uuid, uuid, text, uuid, text) TO service_role;

-- 適用後の確認:
--   1. 画面の「決定にする」がこれまでどおり動く（控えに kind='decided' が付く）。
--   2. `agentpm` から決定にすると、task_events.actor_id が鍵の持ち主になる。
--   3. authenticated が rpc_set_spec_state_as を呼ぶと権限エラーになる。
--   4. 相手先の役割では、どちらの入口からも拒否される（app_can_write_space の既存の歯止め）。
