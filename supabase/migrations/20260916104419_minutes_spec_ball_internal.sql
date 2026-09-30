-- 議事録から作る決定事項のタスクを、社内にボールを置いた状態で作る
--
-- タスク化で作られる決定事項（spec）のタスクは、ボールが必ず `client`（相手先）になっていた。
-- 既存の SPEC 行の作り方に合わせたもので、「決めるのは相手先」という読みだった。
--
-- だが「決めてください」の催促（process_spec_decision_nudges）は、**ボールを持っている側の
-- 担当者**へ送る（task_owners.side = tasks.ball）。そしてタスク化は task_owners を1行も
-- 作らない。結果、タスク化で作った決定事項のタスクは、期限を過ぎても会議が終わっても
-- **誰にも届かない**。顧客側の担当を置いていない案件では、置きようもない。
--
-- 実際にそうなっていた。あるプロジェクトでは決定事項のタスク13件がすべて ball='client' /
-- 担当0人で、受信トレイの「仕様決定」タブは空のままだった。
--
-- 2つ直す。
--   1. 決定事項のタスクのボールを `internal` にする（ふつうのタスクは元から internal）。
--   2. 決定事項のタスクを作るとき、社内側の担当を1人だけ入れる。行で担当者を選んでいれば
--      その人、選んでいなければタスク化を押した人。
--
-- ふつうのタスクには担当（task_owners）を入れない。task_create と揃えるため。
-- 相手先に決めてもらう案件では、これまでどおり `ball pass` で相手先に渡す。
--
-- 拾う行の条件・タスクの種別・期限の解釈・担当者とマイルストーンの印・認可・目印の付け方は
-- 20260915195531 のまま。変えたのは上の2点だけ。
--
-- ロールバックについて: 関数の作り直しだけで、表も列も触らない。戻したいときは
-- 20260915195531_minutes_task_assignee_milestone.sql をもう一度流せば元に戻る。
-- ただし**このあと作られたタスクのボールと担当は戻らない**（作成時に入れた値なので残る）。
-- 既に作られたものを社内へ戻すには `ball pass --ball internal --internal-owner-ids <人>`。

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
            'considering', 'internal', 'internal', 'spec',
            v_spec_path, 'considering', v_due_date, v_actor_id,
            v_assignee_id, v_milestone_id
          )
          RETURNING id INTO v_new_task_id;

          -- 「決めてください」の宛先。ボールを持つ側（internal）の担当が1人もいないと、
          -- process_spec_decision_nudges() は誰にも送れない。行で担当者を選んでいれば
          -- その人、選んでいなければ作った人を置く。
          INSERT INTO task_owners (org_id, space_id, task_id, side, user_id)
          VALUES (
            v_meeting.org_id, v_meeting.space_id, v_new_task_id, 'internal',
            COALESCE(v_assignee_id, v_actor_id)
          )
          ON CONFLICT (task_id, side, user_id) DO NOTHING;

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
                -- 決めるのは社内。顧客側の担当を置いていない案件でボールを相手先にすると、
                -- 「決めてください」の宛先（task_owners.side = tasks.ball）が空になり誰にも届かない。
                'internal',
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

              -- 決定事項のタスクだけ、ボールを持つ側の担当を1人置く（上と同じ理由）。
              -- ふつうのタスクは task_create と揃えて、担当を置かないままにする。
              IF v_is_spec THEN
                INSERT INTO task_owners (org_id, space_id, task_id, side, user_id)
                VALUES (
                  v_meeting.org_id, v_meeting.space_id, v_new_task_id, 'internal',
                  COALESCE(v_assignee_id, v_actor_id)
                )
                ON CONFLICT (task_id, side, user_id) DO NOTHING;
              END IF;

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
-- SECURITY DEFINER の本体なので、誰にも実行権を渡さない（20260915195531 と同じ）。

-- 適用後の確認:
--   1. 議事録に「仕様書として扱う」Wikiページを貼った未チェックの行を書いてタスク化する
--      → できた決定事項のタスクの ball が internal、task_owners に side=internal の行が1件。
--   2. その行で担当者を選んでいれば task_owners.user_id がその人、選んでいなければ押した人。
--   3. 期限を過ぎた状態で process_spec_decision_nudges() を流すと、その人の受信トレイに
--      「決めてください」が入る（これまでは0件だった）。
--   4. Wikiページを貼っていないふつうのタスクは ball=internal のまま、task_owners は空。
--   5. 同じ行をもう一度タスク化しても task_owners は増えない（task_id・side・user_id で一意）。
