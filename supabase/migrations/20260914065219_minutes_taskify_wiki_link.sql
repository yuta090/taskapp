-- 議事録のタスク化で、Wiki ページを指せるようにする
--
-- これまで拾えたのは `- [ ] SPEC(/spec/FILE.md#anchor): 題名` の形だけだった。
-- `/spec/...` は開発用の仕様書ファイルを指す書き方で、打ち合わせで使う Wiki ページは
-- 指定できない。そのため業務の会議ではこのボタンが使えず、会議のあとに手でタスクを
-- 作って Wiki を紐づけていた。
--
-- 足す規則:「未チェックのチェックリスト行に Wiki ページへのリンクが入っていたら候補」。
-- 新しい書き方を覚える必要はなく、本文にリンクを差し込む既存の操作（「/」→ Wiki）が
-- そのまま使える。
--
-- 紐づけ先の扱いは**画面（TaskInspector の「仕様書連携」）と同じ**にする:
--   - 「仕様書」タグ付きのページ → 決定事項のタスク（type='spec', decision_state='considering'）。
--     決まるまで完了できない（enforce_review_gate）。
--   - タグ無しのページ         → ふつうのタスクに、そのページを参考資料として紐づける。
--     完了は止めない。
--
-- 判定に使う 2 つのパターンは TS 側 `src/lib/minutes/wikiTaskCandidate.ts` と
-- **同じ文字列**にすること。片方だけ直すと、画面に出る候補一覧と実際に作られるタスクが
-- 食い違う。`src/__tests__/lib/minutes/wikiTaskCandidate.test.ts` が最新のマイグレーションを
-- 探して突き合わせる。
--
-- 旧来の SPEC 行の扱いは一切変えていない（ELSIF なので SPEC 行はこれまでどおり先に処理する）。

-- 「期限: M/D」「期限: YYYY/M/D」の解釈を1か所にまとめる。
-- これまで rpc_parse_meeting_minutes の中に直接書かれていたものを関数に出しただけだが、
-- 1点だけ直している: 年の基準を CURRENT_DATE（サーバーの時間帯 = UTC）ではなく
-- **日本時間の今日**にした。UTC のままだと日本の朝9時までは前日として扱われ、
-- 「期限: 12/31」が1年ずれることがある（この repo の JST の決まりに合わせる）。
CREATE OR REPLACE FUNCTION public._minutes_due_date(p_src text)
RETURNS date
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_parts text[];
  v_year int;
  v_month int;
  v_day int;
  v_today date;
  v_due date;
BEGIN
  IF p_src IS NULL OR btrim(p_src) = '' THEN
    RETURN NULL;
  END IF;

  v_today := (now() AT TIME ZONE 'Asia/Tokyo')::date;
  v_parts := string_to_array(btrim(p_src), '/');

  IF array_length(v_parts, 1) = 2 THEN
    -- M/D。年の指定が無いので日本時間の今年として読み、過ぎていれば来年にする
    v_year := extract(year from v_today);
    v_month := v_parts[1]::int;
    v_day := v_parts[2]::int;
    IF v_month BETWEEN 1 AND 12 AND v_day BETWEEN 1 AND 31 THEN
      v_due := make_date(v_year, v_month, v_day);
      IF v_due < v_today THEN
        v_due := make_date(v_year + 1, v_month, v_day);
      END IF;
      RETURN v_due;
    END IF;
    RETURN NULL;
  ELSIF array_length(v_parts, 1) = 3 THEN
    v_year := v_parts[1]::int;
    v_month := v_parts[2]::int;
    v_day := v_parts[3]::int;
    IF v_year BETWEEN 1900 AND 2100 AND v_month BETWEEN 1 AND 12 AND v_day BETWEEN 1 AND 31 THEN
      RETURN make_date(v_year, v_month, v_day);
    END IF;
    RETURN NULL;
  END IF;

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- 2/30 のような実在しない日付など。期限なしとして扱う（タスク化そのものは止めない）
  RETURN NULL;
END;
$$;

-- 内部用の補助関数。呼ぶのは上の 2 つの SECURITY DEFINER 関数（所有者として動く）だけなので、
-- 誰にも実行権を渡さない。
REVOKE ALL ON FUNCTION public._minutes_due_date(text) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.rpc_get_minutes_preview(
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
  v_actor_id := auth.uid();
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
  IF NOT public.app_can_write_space(v_meeting.space_id, v_meeting.org_id) THEN
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
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_parse_meeting_minutes(
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
  v_actor_id := auth.uid();
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
  IF NOT public.app_can_write_space(v_meeting.space_id, v_meeting.org_id) THEN
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
END;
$$;

-- 実行権は create or replace では変わらないが、作り直しに備えて明示する
-- （この repo の既定では新しい関数に実行権は付かない）。
REVOKE ALL ON FUNCTION public.rpc_get_minutes_preview(uuid, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.rpc_parse_meeting_minutes(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_get_minutes_preview(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_parse_meeting_minutes(uuid, text) TO authenticated, service_role;

-- 適用後の確認:
--   1. Wiki に「仕様書」タグ付きのページを1枚作る。
--   2. 会議の議事録に「- [ ] 玄関の向きを決める」と書き、その行に「/」→ Wiki でそのページの
--      リンクを差し込む。
--   3. 会議詳細の「タスク化」タブに候補として出て、押すと type='spec' /
--      decision_state='considering' / wiki_page_id が入ったタスクができること。
--   4. タグを外したページで同じことをすると、type='task' / decision_state is null /
--      wiki_page_id が入ったタスクになること（完了を止めない）。
--   5. 旧来の `- [ ] SPEC(/spec/a.md#x): 題名` がこれまでどおり動くこと。
--   6. 別の space のページ ID を手で書いた行では、タスクが作られないこと。
