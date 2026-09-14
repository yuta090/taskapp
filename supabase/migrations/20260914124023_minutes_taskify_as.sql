-- CLI / API からも議事録をタスク化できるようにする
--
-- 画面には会議の「タスク化」タブがあるのに、CLI・AI秘書には相当する道具が無かった。
-- そのため「議事録は CLI で書けるのに、タスクを作るところだけ画面を開く」という行き来が要る。
--
-- 20260912134823 / 20260914100928 と同じ型で、本体を _impl（実行者を引数で受ける）に出し、
-- 画面用（auth.uid()）と道具用（_as）で包む。本体の中身は 20260914065219 の定義をそのまま
-- 写し、変えたのは2か所だけ:
--   1. 実行者の取り方（auth.uid() → p_actor）
--   2. 権限の確認を app_can_write_space → _actor_can_write_space（前者は中で auth.uid() を
--      見るので、鍵で動く道具から呼ぶと必ず弾かれる。20260914100928 で踏んだのと同じ罠）
--
-- 「渡された本文が DB の本文と同じか」の歯止め（minutes_stale）はそのまま。CLI から
-- 呼ぶときも、直前に読んだ本文を渡すことで他の人の書き込みを消さない。

CREATE OR REPLACE FUNCTION public._get_minutes_preview_impl(
  p_actor uuid,
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
  v_body text;
  v_page_id text;
  v_page_title text;
  v_page_tags text[];
  v_is_spec boolean;
  -- 1回に扱う候補の上限。極端に長い本文を貼られたときに、何百件も一度に作らないための歯止め。
  -- 超えたぶんは次に押したときの候補として残る（作成済みの行は目印で飛ばされるため）。
  c_max_candidates constant int := 200;
BEGIN
  v_actor_id := p_actor;
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_meeting FROM meetings WHERE id = p_meeting_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Meeting not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM meeting_participants mp
    WHERE mp.meeting_id = p_meeting_id AND mp.user_id = v_actor_id
  ) AND NOT EXISTS (
    SELECT 1 FROM space_memberships sm
    WHERE sm.space_id = v_meeting.space_id AND sm.user_id = v_actor_id
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- 書き込める役割（社内の admin / editor）だけが通る
  IF NOT public._actor_can_write_space(v_actor_id, v_meeting.space_id, v_meeting.org_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  v_lines := string_to_array(p_minutes_md, E'\n');

  FOREACH v_line IN ARRAY v_lines LOOP
    v_line_num := v_line_num + 1;

    -- 上限に達したら、以降の行はもう候補にしない
    EXIT WHEN jsonb_array_length(v_new_lines) >= c_max_candidates;

    -- 旧来の SPEC 行（未チェックのみ）
    IF v_line ~ '^-\s*\[\s*\]\s*SPEC\([^)]+\):\s*.+$' THEN
      v_has_marker := v_line ~ '<!--task:[^>]+-->\s*$';
      v_spec_path := substring(v_line from 'SPEC\(([^)]+)\)');

      IF v_spec_path IS NOT NULL AND v_spec_path ~ '^/spec/[^#\s]+#\S+$' THEN
        v_title := substring(v_line from 'SPEC\([^)]+\):\s*([^（(]+)');
        IF v_title IS NOT NULL THEN
          v_title := trim(v_title);
        END IF;

        IF v_has_marker THEN
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

    -- 新: Wiki ページへのリンクが入った未チェックのチェックリスト行
    ELSIF v_line ~ '^-\s*\[\s*\]\s*(.+)$' THEN
      v_has_marker := v_line ~ '<!--task:[^>]+-->\s*$';
      v_body := substring(v_line from '^-\s*\[\s*\]\s*(.+)$');
      v_page_id := substring(v_body from '/wiki\?page=([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})');

      IF v_page_id IS NOT NULL THEN
        -- 同じ org / space のページに限る（別の場所のページを指すタスクを作らない）
        SELECT w.title, w.tags INTO v_page_title, v_page_tags
        FROM wiki_pages w
        WHERE w.id = v_page_id::uuid
          AND w.org_id = v_meeting.org_id
          AND w.space_id = v_meeting.space_id;

        IF FOUND THEN
          -- 題名 = 行の文字から、目印と Markdown のリンクを取り除いたもの
          v_title := regexp_replace(v_body, '<!--task:[^>]+-->\s*$', '');
          v_title := regexp_replace(v_title, '\[([^\]]*)\]\(([^)]*)\)', '', 'g');
          v_title := btrim(regexp_replace(v_title, '\s+', ' ', 'g'));
          IF v_title = '' THEN
            -- 題名が空ならリンクの文字を使う
            v_title := btrim(coalesce(
              substring(v_body from '\[([^\]]*)\]\([^)]*' || v_page_id || '[^)]*\)'), ''));
          END IF;

          IF v_title <> '' THEN
            v_is_spec := '仕様書' = ANY(coalesce(v_page_tags, ARRAY[]::text[]));

            IF v_has_marker THEN
              v_existing_task_id := substring(v_line from '<!--task:([^>]+)-->');
              v_existing_lines := v_existing_lines || jsonb_build_object(
                'line_number', v_line_num,
                'title', v_title,
                'wiki_page_id', v_page_id,
                'wiki_page_title', v_page_title,
                'is_spec', v_is_spec,
                'task_id', v_existing_task_id
              );
            ELSE
              v_new_lines := v_new_lines || jsonb_build_object(
                'line_number', v_line_num,
                'title', v_title,
                'wiki_page_id', v_page_id,
                'wiki_page_title', v_page_title,
                'is_spec', v_is_spec
              );
            END IF;
          END IF;
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
END;$$;

REVOKE ALL ON FUNCTION public._get_minutes_preview_impl(uuid, uuid, text)
  FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public._parse_meeting_minutes_impl(
  p_actor uuid,
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
  v_due_date date;
  v_new_task_id uuid;
  v_created_tasks jsonb := '[]'::jsonb;
  v_updated_minutes text := '';
  v_lines text[];
  v_has_marker boolean;
  v_task_marker text;
  v_body text;
  v_page_id text;
  v_page_title text;
  v_page_tags text[];
  v_is_spec boolean;
  v_due_src text;
  -- 1回に作るタスクの上限。プレビュー側と同じ数にする。超えたぶんは目印が付かないので、
  -- もう一度押せば続きが作られる。
  c_max_candidates constant int := 200;
BEGIN
  v_actor_id := p_actor;
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_meeting FROM meetings WHERE id = p_meeting_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Meeting not found: %', p_meeting_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM meeting_participants mp
    WHERE mp.meeting_id = p_meeting_id AND mp.user_id = v_actor_id
  ) AND NOT EXISTS (
    SELECT 1 FROM space_memberships sm
    WHERE sm.space_id = v_meeting.space_id AND sm.user_id = v_actor_id
  ) THEN
    RAISE EXCEPTION 'Not authorized to parse minutes for this meeting';
  END IF;

  -- 書き込める役割（社内の admin / editor）だけが通る
  IF NOT public._actor_can_write_space(v_actor_id, v_meeting.space_id, v_meeting.org_id) THEN
    RAISE EXCEPTION 'Not authorized to parse minutes for this meeting';
  END IF;

  -- 渡された本文が、いま DB にある本文と同じかを確かめる。違っていたら何も書かずに止める
  -- （20260913040637 で足した歯止め。画面が確かめてから書き込むまでの隙間に入った
  --  ほかの人・AI秘書・MCP の書き込みを消さないため）。
  IF coalesce(v_meeting.minutes_md, '') IS DISTINCT FROM coalesce(p_minutes_md, '') THEN
    RAISE EXCEPTION 'この議事録は、別の場所で更新されています。最新を読み込んでからもう一度お試しください'
      USING ERRCODE = 'P0001', HINT = 'minutes_stale';
  END IF;

  v_lines := string_to_array(p_minutes_md, E'\n');

  FOREACH v_line IN ARRAY v_lines LOOP
    v_line_num := v_line_num + 1;
    v_due_date := NULL;

    -- 旧来の SPEC 行（未チェックのみ）
    IF v_line ~ '^-\s*\[\s*\]\s*SPEC\([^)]+\):\s*.+$' THEN
      v_has_marker := v_line ~ '<!--task:[^>]+-->\s*$';

      -- 上限に達していたら、この行は作らずに残す（次に押したときの候補になる）
      IF NOT v_has_marker AND jsonb_array_length(v_created_tasks) < c_max_candidates THEN
        v_spec_path := substring(v_line from 'SPEC\(([^)]+)\)');

        IF v_spec_path IS NOT NULL AND v_spec_path ~ '^/spec/[^#\s]+#\S+$' THEN
          v_title := substring(v_line from 'SPEC\([^)]+\):\s*([^（(]+)');
          IF v_title IS NOT NULL THEN
            v_title := trim(v_title);
          ELSE
            v_title := 'Untitled SPEC task';
          END IF;

          v_due_src := substring(v_line from '期限:\s*(\d+/\d+(?:/\d+)?)');
          v_due_date := public._minutes_due_date(v_due_src);

          INSERT INTO tasks (
            org_id, space_id, title, status, ball, origin, type,
            spec_path, decision_state, due_date, created_by
          ) VALUES (
            v_meeting.org_id, v_meeting.space_id, v_title,
            'considering', 'client', 'internal', 'spec',
            v_spec_path, 'considering', v_due_date, v_actor_id
          )
          RETURNING id INTO v_new_task_id;

          INSERT INTO task_events (
            org_id, space_id, task_id, actor_id, meeting_id, action, payload
          ) VALUES (
            v_meeting.org_id, v_meeting.space_id, v_new_task_id, v_actor_id, p_meeting_id,
            'SPEC_CREATED',
            jsonb_build_object(
              'source', 'minutes_parser',
              'spec_path', v_spec_path,
              'line_number', v_line_num
            )
          );

          v_task_marker := format(' <!--task:%s-->', v_new_task_id);
          v_line := rtrim(v_line) || v_task_marker;

          v_created_tasks := v_created_tasks || jsonb_build_object(
            'task_id', v_new_task_id,
            'title', v_title,
            'spec_path', v_spec_path,
            'due_date', v_due_date,
            'line_number', v_line_num
          );
        END IF;
      END IF;

    -- 新: Wiki ページへのリンクが入った未チェックのチェックリスト行
    ELSIF v_line ~ '^-\s*\[\s*\]\s*(.+)$' THEN
      v_has_marker := v_line ~ '<!--task:[^>]+-->\s*$';

      -- 上限に達していたら、この行は作らずに残す（次に押したときの候補になる）
      IF NOT v_has_marker AND jsonb_array_length(v_created_tasks) < c_max_candidates THEN
        v_body := substring(v_line from '^-\s*\[\s*\]\s*(.+)$');
        v_page_id := substring(v_body from '/wiki\?page=([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})');

        IF v_page_id IS NOT NULL THEN
          -- 同じ org / space のページに限る（別の場所のページを指すタスクを作らない）
          SELECT w.title, w.tags INTO v_page_title, v_page_tags
          FROM wiki_pages w
          WHERE w.id = v_page_id::uuid
            AND w.org_id = v_meeting.org_id
            AND w.space_id = v_meeting.space_id;

          IF FOUND THEN
            v_title := regexp_replace(v_body, '<!--task:[^>]+-->\s*$', '');
            v_title := regexp_replace(v_title, '\[([^\]]*)\]\(([^)]*)\)', '', 'g');
            v_title := btrim(regexp_replace(v_title, '\s+', ' ', 'g'));
            IF v_title = '' THEN
              v_title := btrim(coalesce(
                substring(v_body from '\[([^\]]*)\]\([^)]*' || v_page_id || '[^)]*\)'), ''));
            END IF;

            IF v_title <> '' THEN
              v_is_spec := '仕様書' = ANY(coalesce(v_page_tags, ARRAY[]::text[]));

              v_due_src := substring(v_line from '期限:\s*(\d+/\d+(?:/\d+)?)');
              v_due_date := public._minutes_due_date(v_due_src);

              INSERT INTO tasks (
                org_id, space_id, title, status, ball, origin, type,
                wiki_page_id, decision_state, due_date, created_by
              ) VALUES (
                v_meeting.org_id,
                v_meeting.space_id,
                v_title,
                CASE WHEN v_is_spec THEN 'considering' ELSE 'todo' END,
                -- 決定事項のタスクは相手先に返す（既存の SPEC 行の作り方に合わせる）。
                -- 参考資料を紐づけただけのふつうのタスクは社内のまま。
                CASE WHEN v_is_spec THEN 'client' ELSE 'internal' END,
                'internal',
                CASE WHEN v_is_spec THEN 'spec' ELSE 'task' END,
                v_page_id::uuid,
                CASE WHEN v_is_spec THEN 'considering' ELSE NULL END,
                v_due_date,
                v_actor_id
              )
              RETURNING id INTO v_new_task_id;

              INSERT INTO task_events (
                org_id, space_id, task_id, actor_id, meeting_id, action, payload
              ) VALUES (
                v_meeting.org_id, v_meeting.space_id, v_new_task_id, v_actor_id, p_meeting_id,
                -- 決定事項のタスクは既存の SPEC 行と同じ 'SPEC_CREATED'。ふつうのタスクは
                -- 既に使われている 'TASK_CREATE' に合わせる（似た名前を増やさない）
                CASE WHEN v_is_spec THEN 'SPEC_CREATED' ELSE 'TASK_CREATE' END,
                jsonb_build_object(
                  'source', 'minutes_parser',
                  'wiki_page_id', v_page_id,
                  'line_number', v_line_num
                )
              );

              v_task_marker := format(' <!--task:%s-->', v_new_task_id);
              v_line := rtrim(v_line) || v_task_marker;

              v_created_tasks := v_created_tasks || jsonb_build_object(
                'task_id', v_new_task_id,
                'title', v_title,
                'wiki_page_id', v_page_id,
                'wiki_page_title', v_page_title,
                'is_spec', v_is_spec,
                'due_date', v_due_date,
                'line_number', v_line_num
              );
            END IF;
          END IF;
        END IF;
      END IF;
    END IF;

    IF v_line_num > 1 THEN
      v_updated_minutes := v_updated_minutes || E'\n';
    END IF;
    v_updated_minutes := v_updated_minutes || v_line;
  END LOOP;

  UPDATE meetings
  SET minutes_md = v_updated_minutes,
      updated_at = now()
  WHERE id = p_meeting_id;

  RETURN jsonb_build_object(
    'ok', true,
    'created_count', jsonb_array_length(v_created_tasks),
    'created_tasks', v_created_tasks,
    'updated_minutes', v_updated_minutes
  );
END;$$;

REVOKE ALL ON FUNCTION public._parse_meeting_minutes_impl(uuid, uuid, text)
  FROM public, anon, authenticated;

-- ---- 画面用（ログイン中の利用者が実行者） ----
CREATE OR REPLACE FUNCTION public.rpc_get_minutes_preview(
  p_meeting_id uuid,
  p_minutes_md text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public._get_minutes_preview_impl(auth.uid(), p_meeting_id, p_minutes_md);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_get_minutes_preview(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_get_minutes_preview(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rpc_parse_meeting_minutes(
  p_meeting_id uuid,
  p_minutes_md text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public._parse_meeting_minutes_impl(auth.uid(), p_meeting_id, p_minutes_md);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_parse_meeting_minutes(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_parse_meeting_minutes(uuid, text) TO authenticated, service_role;

-- ---- 道具用（CLI / API / AI秘書。誰が押したかを呼び出し側が明示する） ----
CREATE OR REPLACE FUNCTION public.rpc_get_minutes_preview_as(
  p_actor uuid,
  p_meeting_id uuid,
  p_minutes_md text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public._get_minutes_preview_impl(p_actor, p_meeting_id, p_minutes_md);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_get_minutes_preview_as(uuid, uuid, text)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_get_minutes_preview_as(uuid, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.rpc_parse_meeting_minutes_as(
  p_actor uuid,
  p_meeting_id uuid,
  p_minutes_md text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public._parse_meeting_minutes_impl(p_actor, p_meeting_id, p_minutes_md);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_parse_meeting_minutes_as(uuid, uuid, text)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_parse_meeting_minutes_as(uuid, uuid, text) TO service_role;

-- 適用後の確認:
--   1. 画面の会議「タスク化」タブがこれまでどおり動く（候補が出る・押すとタスクができる）。
--   2. `agentpm minutes taskify --meeting-id <id>` で同じタスクができ、task_events.actor_id が
--      鍵の持ち主になる。
--   3. 本文がずれていると「別の場所で更新されています」で止まり、tasks が1件も増えない。
--   4. authenticated が _as を呼ぶと権限エラーになる。
