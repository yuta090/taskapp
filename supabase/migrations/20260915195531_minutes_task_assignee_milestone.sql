-- 議事録の行から作るタスクに、担当者とマイルストーンを入れられるようにする
--
-- いま議事録の行から作られるタスクは、担当者もマイルストーンも必ず空になる。行の文字から
-- 読み取れるのが題名・期限・資料のページだけで、人とマイルストーンを指す道が無かったため。
-- 会議で「これは田中さん」と決めても、あとで一覧を開いて付け直すことになっていた。
--
-- 行に**印**を足して読み取る。書き方は会議メモの `<!--note:日時 書いた人-->` と同じ考え方:
--   `- [ ] 見積を出す <!--assignee:<uuid> 田中--> <!--milestone:<uuid> 第1弾-->`
-- ID と名前を両方入れるのは、**名前は画面に出すため・ID は作るときのため**。名前だけだと
-- 同姓の人を取り違え、ID だけだと本文を見ても誰なのか分からない。ここで見るのは ID だけなので、
-- 名前があとで変わっても、作られるタスクの担当者は選んだ本人のまま変わらない。
--
-- 印は行末（タスク化済みの `<!--task:...-->` より前）に並ぶが、読み取りは行のどこからでも拾う。
-- 手で動かされても担当者が消えないようにするため。
--
-- **この関数は SECURITY DEFINER（呼んだ人の権限を問わずに書ける）なので、印の ID は必ず
-- 確かめてから入れる。** 担当者はその space のメンバーであること、マイルストーンはその space の
-- ものであることを見て、外れていれば黙って空にする（本文を手で書き換えて、関係の無い人へ
-- タスクを割り当てられないようにする）。1行の印が外れていても、ほかの行のタスク化は止めない。
--
-- 題名からは印を取り除く。残すと一覧に「見積を出す <!--assignee:...-->」と出てしまう。
-- 取り除くパターンは TS 側（src/lib/minutes/wikiTaskCandidate.ts の TASK_META_MARKER_PATTERN）と
-- 同じ文字にしてあり、src/__tests__/lib/minutes/wikiTaskCandidate.test.ts が最新の
-- マイグレーションから抜き出して突き合わせる。
--
-- 拾う行の条件・作られるタスクの種別（ふつうのタスク / 決定事項）・期限の解釈・認可・
-- 本文の突き合わせ（minutes_stale）・目印の付け方は 20260915064434 のまま。
--
-- ロールバックについて: この差分は関数の作り直しだけで、表も列も触らない。戻したいときは
-- 20260915064434_minutes_due_out_of_title.sql の 2 つの関数をもう一度流せば元に戻る。
-- ただし**このあと作られたタスクの担当者・マイルストーンは戻らない**（作成時に入れた値なので、
-- 入ったまま残る）。不可逆なのはそこだけ。
-- 行の印から担当者を読み取る。**その space のメンバーでなければ NULL**。
-- 本文は誰でも書き換えられるので、ここを通さずに tasks.assignee_id へ入れてはいけない
-- （この関数を呼ぶのは SECURITY DEFINER の本体で、外部キーだけでは space の外の人を弾けない）。
CREATE OR REPLACE FUNCTION public._minutes_line_assignee(p_line text, p_space_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT sm.user_id
  FROM space_memberships sm
  WHERE sm.space_id = p_space_id
    AND sm.user_id = substring(
      p_line from
      '<!--assignee:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})'
    )::uuid
  LIMIT 1
$$;

-- 内部用の補助関数。呼ぶのは下の 2 つの SECURITY DEFINER 関数（所有者として動く）だけなので、
-- 誰にも実行権を渡さない。
REVOKE ALL ON FUNCTION public._minutes_line_assignee(text, uuid) FROM public, anon, authenticated;

-- 行の印からマイルストーンを読み取る。**その space のものでなければ NULL**。
CREATE OR REPLACE FUNCTION public._minutes_line_milestone(p_line text, p_space_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT m.id
  FROM milestones m
  WHERE m.space_id = p_space_id
    AND m.id = substring(
      p_line from
      '<!--milestone:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})'
    )::uuid
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public._minutes_line_milestone(text, uuid) FROM public, anon, authenticated;

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
        -- **印を先に落としてから**題名を取る。この書き方の題名は最初の丸括弧の手前までなので、
        -- あとから消そうとすると「田中（営業）」のように名前に括弧が入った印を外しきれない
        -- （題名が `<!--assignee:... 田中` で切れて残る）
        v_title := substring(
          regexp_replace(v_line, '\s*<!--(assignee|milestone):[^>]*-->', '', 'g')
          from 'SPEC\([^)]+\):\s*([^（(]+)');
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

      -- ページのリンクがあれば紐づけ先として確かめる。同じ org / space のものに限る。
      -- 別の場所のページを指していたら紐づけないが、**行そのものは候補にする**
      -- （リンクの有無で拾う・拾わないを分けない）
      v_page_title := NULL;
      v_page_tags := NULL;
      IF v_page_id IS NOT NULL THEN
        SELECT w.title, w.tags INTO v_page_title, v_page_tags
        FROM wiki_pages w
        WHERE w.id = v_page_id::uuid
          AND w.org_id = v_meeting.org_id
          AND w.space_id = v_meeting.space_id;
        IF NOT FOUND THEN
          v_page_id := NULL;
        END IF;
      END IF;

      -- 題名 = 行の文字から、目印と Markdown のリンクと期限の書き方を取り除いたもの
      v_title := regexp_replace(v_body, '<!--task:[^>]+-->\s*$', '');
      -- 担当者・マイルストーンはそれぞれの欄に入るので、題名には残さない
      v_title := regexp_replace(v_title, '\s*<!--(assignee|milestone):[^>]*-->', '', 'g');
      v_title := regexp_replace(v_title, '\[([^\]]*)\]\(([^)]*)\)', '', 'g');
      -- 期限は日付の欄に入るので、題名には残さない（前後の丸括弧ごと外す・括弧が無くても外す）
      v_title := regexp_replace(v_title, '\s*[（(]?\s*期限:\s*\d+/\d+(?:/\d+)?\s*[）)]?', '', 'g');
      v_title := btrim(regexp_replace(v_title, '\s+', ' ', 'g'));
      IF v_title = '' AND v_page_id IS NOT NULL THEN
        -- 題名が空ならリンクの文字を使う
        v_title := btrim(coalesce(
          substring(v_body from '\[([^\]]*)\]\([^)]*' || v_page_id || '[^)]*\)'), ''));
      END IF;

      IF v_title <> '' THEN
        v_is_spec := v_page_id IS NOT NULL
                 AND '仕様書' = ANY(coalesce(v_page_tags, ARRAY[]::text[]));

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
  -- 行の印から読み取った担当者・マイルストーン。確かめたあとだけ値が入る（外れていれば NULL）
  v_assignee_id uuid;
  v_milestone_id uuid;
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
    -- 行ごとに必ず空へ戻す。残したままだと、前の行で選ばれた担当者が
    -- 印の無い次の行にも付いてしまう
    v_assignee_id := NULL;
    v_milestone_id := NULL;

    -- 旧来の SPEC 行（未チェックのみ）
    IF v_line ~ '^-\s*\[\s*\]\s*SPEC\([^)]+\):\s*.+$' THEN
      v_has_marker := v_line ~ '<!--task:[^>]+-->\s*$';

      -- 上限に達していたら、この行は作らずに残す（次に押したときの候補になる）
      IF NOT v_has_marker AND jsonb_array_length(v_created_tasks) < c_max_candidates THEN
        v_spec_path := substring(v_line from 'SPEC\(([^)]+)\)');

        IF v_spec_path IS NOT NULL AND v_spec_path ~ '^/spec/[^#\s]+#\S+$' THEN
          -- **印を先に落としてから**題名を取る（preview 側の同じ場所と同じ理由。
          -- 名前に丸括弧が入ると、あとからでは印を外しきれない）
          v_title := substring(
            regexp_replace(v_line, '\s*<!--(assignee|milestone):[^>]*-->', '', 'g')
            from 'SPEC\([^)]+\):\s*([^（(]+)');
          IF v_title IS NOT NULL THEN
            v_title := trim(v_title);
          END IF;
          IF v_title IS NULL OR v_title = '' THEN
            v_title := 'Untitled SPEC task';
          END IF;

          v_due_src := substring(v_line from '期限:\s*(\d+/\d+(?:/\d+)?)');
          v_due_date := public._minutes_due_date(v_due_src);
          v_assignee_id := public._minutes_line_assignee(v_line, v_meeting.space_id);
          v_milestone_id := public._minutes_line_milestone(v_line, v_meeting.space_id);

          INSERT INTO tasks (
            org_id, space_id, title, status, ball, origin, type,
            spec_path, decision_state, due_date, created_by,
            assignee_id, milestone_id
          ) VALUES (
            v_meeting.org_id, v_meeting.space_id, v_title,
            'considering', 'client', 'internal', 'spec',
            v_spec_path, 'considering', v_due_date, v_actor_id,
            v_assignee_id, v_milestone_id
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

        -- ページのリンクがあれば紐づけ先として確かめる。同じ org / space のものに限る。
      -- 別の場所のページを指していたら紐づけないが、**行そのものは候補にする**
      -- （リンクの有無で拾う・拾わないを分けない）
      v_page_title := NULL;
      v_page_tags := NULL;
      IF v_page_id IS NOT NULL THEN
        SELECT w.title, w.tags INTO v_page_title, v_page_tags
        FROM wiki_pages w
        WHERE w.id = v_page_id::uuid
          AND w.org_id = v_meeting.org_id
          AND w.space_id = v_meeting.space_id;
        IF NOT FOUND THEN
          v_page_id := NULL;
        END IF;
      END IF;

      -- 題名 = 行の文字から、目印と Markdown のリンクと期限の書き方を取り除いたもの
      v_title := regexp_replace(v_body, '<!--task:[^>]+-->\s*$', '');
      -- 担当者・マイルストーンは下の _minutes_line_assignee / _minutes_line_milestone
      -- （v_line をそのまま見る）で読み取るので、題名には残さない
      v_title := regexp_replace(v_title, '\s*<!--(assignee|milestone):[^>]*-->', '', 'g');
      v_title := regexp_replace(v_title, '\[([^\]]*)\]\(([^)]*)\)', '', 'g');
      -- 期限は下の v_due_src（v_line をそのまま見る）で読み取るので、題名には残さない。
      -- ここで題名から外しても、期限の取り方は変わらない。
      v_title := regexp_replace(v_title, '\s*[（(]?\s*期限:\s*\d+/\d+(?:/\d+)?\s*[）)]?', '', 'g');
      v_title := btrim(regexp_replace(v_title, '\s+', ' ', 'g'));
      IF v_title = '' AND v_page_id IS NOT NULL THEN
        -- 題名が空ならリンクの文字を使う
        v_title := btrim(coalesce(
          substring(v_body from '\[([^\]]*)\]\([^)]*' || v_page_id || '[^)]*\)'), ''));
      END IF;

      IF v_title <> '' THEN
        v_is_spec := v_page_id IS NOT NULL
                 AND '仕様書' = ANY(coalesce(v_page_tags, ARRAY[]::text[]));

              v_due_src := substring(v_line from '期限:\s*(\d+/\d+(?:/\d+)?)');
              v_due_date := public._minutes_due_date(v_due_src);
              -- 印の相手がその space の人・その space のマイルストーンでなければ空にする
              v_assignee_id := public._minutes_line_assignee(v_line, v_meeting.space_id);
              v_milestone_id := public._minutes_line_milestone(v_line, v_meeting.space_id);

              INSERT INTO tasks (
                org_id, space_id, title, status, ball, origin, type,
                wiki_page_id, decision_state, due_date, created_by,
                assignee_id, milestone_id
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
                v_actor_id,
                v_assignee_id,
                v_milestone_id
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

-- 包み（画面用 rpc_* / 道具用 rpc_*_as）は 20260914124023 のまま。本体だけ差し替える。
-- 上の 2 つは SECURITY DEFINER の本体で、呼ぶのは所有者として動く包みだけなので、
-- 誰にも実行権を渡さない（20260914150737 と同じ）。

-- 適用後の確認:
--   1. 議事録の「/」→「タスクにする行」で担当者とマイルストーンを選んで入れる → タスク化すると、
--      できたタスクの担当者とマイルストーンが選んだとおりになる。名前は「見積を出す」のまま
--      （印は題名に残らない）。
--   2. 担当者・マイルストーンを選ばなければ、これまでどおりどちらも空のタスクができる。
--   3. 本文の印の ID を、その space に居ない人の ID へ手で書き換える → 担当者は空になり、
--      タスク化そのものは止まらない（ほかの行も作られる）。
--   4. 別の space のマイルストーンの ID を書いても同じく空になる。
--   5. 期限の読み取り・旧来の SPEC 行・拾う行の条件・タスクの種別は変わらない。
