-- =============================================================================
-- 議事録のタスク化が、隙間に入った他の人の書き込みを消さないようにする
--
-- 何を塞ぐか:
--   rpc_parse_meeting_minutes は、画面から渡された本文（p_minutes_md）を解析し、
--   その本文で meetings.minutes_md を**無条件に**上書きしていた（版の一致条件も
--   0 行判定も無い）。画面が直前に「サーバーの最新か」を確かめてから、この関数が
--   commit するまでの1往復ぶんの隙間に、ほかの人・AI秘書・MCP（minutes_update は
--   版を見ない）が書き込むと:
--     1. その追記・編集が DB から消える。画面には「N件のタスクを作成しました」と
--        成功が出る。meetings には wiki_page_versions のような版の控えが無いので
--        復旧できない。
--     2. 隙間で他の人が同じ SPEC 行をタスク化していた場合、こちらは目印
--        （<!--task:uuid-->）が無い本文を見るので、同じ決定事項で2本目のタスクを
--        作ってしまう（先に作られたタスクはどの行からも参照されない迷子になる）。
--
-- どう直すか:
--   権限の確認の直後（解析に入る前）に「渡された本文が、いま DB にある本文と同じか」を
--   確かめ、違っていたら何も書かずに例外を投げる。同じトランザクションなので、
--   ここまでに作った tasks / task_events もすべて巻き戻る（＝二重作成も同時に防げる）。
--
-- なぜこの形か（引数を増やさない）:
--   画面が渡しているのは flushPendingSave() の戻り値＝サーバーにあると分かっている生の
--   本文（MinutesDocumentView の knownServerRawRef）なので、正常時は DB の値と一字一句
--   一致する。一致しない＝隙間で誰かが書いた、と判断できる。基準（版）を別の引数で
--   受け取る形にすると署名が変わり、既存の2引数呼び出しが曖昧になって drop function と
--   grant のやり直しが必要になるため、引数は増やさない。
--   比較は NULL と空文字を同じものとして扱う（本文が空の会議でタスク化しても、
--   これまでどおり0件で通るようにするため）。
--   rpc_get_minutes_preview は書き込まないので触らない。
--
-- 確かめ方:
--   bash supabase/tests/run_minutes_taskify_base_check.sh          （全 PASS）
--   RED=1 bash supabase/tests/run_minutes_taskify_base_check.sh    （この migration 無しでは
--     「追記が消える」「同じ SPEC 行で2本目ができる」が再現することの確認）
--
-- 権限・RLS:
--   create or replace で本体だけを差し替える。関数の実行権（proacl）は replace では
--   変わらないので、20260912063951_definer_anon_execute.sql で付けた
--   「authenticated, service_role だけが実行できる」状態がそのまま残る。
--   SECURITY DEFINER・set search_path = public・社内の編集者だけが通る確認
--   （app_can_write_space）も元のまま。RLS の境界は変えていない（新しい表・列・
--   ポリシーは無い）。
--
-- 戻し方（不可逆なものは無い）:
--   元の定義（supabase/migrations/20260911143112_space_role_boundary.sql の
--   2079〜2292 行）をそのまま再適用すれば、この確認だけが外れて元のふるまいに戻る。
--   表・列・権限は一切変えていないので、ほかに戻すものは無い。
--   （元のふるまい＝渡された本文で無条件に上書きするので、上の穴も戻る）
-- =============================================================================

-- 確認: いまの定義が「写した土台」か「この migration の定義」のどちらかであること。
--   違えば何も変えずに止める（本番だけにある手直しを黙って上書きしないため。
--   20260911143112_space_role_boundary.sql の 946〜978 行と同じ考え方）。
--   止まったら pg_get_functiondef('public.rpc_parse_meeting_minutes(uuid,text)'::regprocedure) と
--   土台のファイルを見比べる。
do $$
declare
  v_md5 text;
begin
  select md5(p.prosrc) into v_md5
    from pg_proc p
   where p.oid = to_regprocedure('public.rpc_parse_meeting_minutes(uuid,text)');

  if v_md5 is null then
    raise exception 'minutes taskify base check: rpc_parse_meeting_minutes(uuid,text) が見つかりません';
  end if;

  if v_md5 not in (
    'c7b8984e45c2a004b61fed657f251439',  -- 土台（20260911143112 が作った定義。2026-09-13 に本番も同じと確認）
    '8f5a8f19e5ba1fbfe55f2812d9c35420'   -- この migration の定義（2回目の適用でもここで止まらない＝冪等）
  ) then
    raise exception 'minutes taskify base check: rpc_parse_meeting_minutes の今の定義が土台と違います（md5=%）', v_md5;
  end if;
end $$;

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

  -- 書き込める役割（社内の admin / editor）だけが通る
  IF NOT public.app_can_write_space(v_meeting.space_id, v_meeting.org_id) THEN
    RAISE EXCEPTION 'Not authorized to parse minutes for this meeting';
  END IF;

  -- 【この migration で足した1か所】渡された本文が、いま DB にある本文と同じかを確かめる。
  -- 違っていたら何も書かずに止める（解析にも入らない）。ここで止めれば、このあとの
  -- tasks / task_events の INSERT も走らないので、隙間で他の人が同じ SPEC 行を
  -- タスク化していたときに2本目を作ってしまうことも起きない。
  -- NULL と空文字は同じものとして扱う（本文が空の会議でタスク化しても、これまでどおり
  -- 0件で通るようにするため）。
  IF coalesce(v_meeting.minutes_md, '') IS DISTINCT FROM coalesce(p_minutes_md, '') THEN
    RAISE EXCEPTION 'この議事録は、別の場所で更新されています。最新を読み込んでからもう一度お試しください'
      USING ERRCODE = 'P0001', HINT = 'minutes_stale';
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

comment on function public.rpc_parse_meeting_minutes(uuid, text) is
  '議事録の未処理 SPEC 行をタスク化し、行末に目印を足した本文で meetings.minutes_md を書き換える。'
  '渡された本文が、いま DB にある本文と違うときは何も書かずに止める（HINT=minutes_stale）。'
  '画面が確かめてから書き込むまでの隙間に入った、ほかの人・AI秘書・MCP の書き込みを消さないため。';

-- 適用後の確認（実行権は create or replace では変わらないが、念のため見る）:
--   select proacl from pg_proc where oid = 'public.rpc_parse_meeting_minutes(uuid,text)'::regprocedure;
--   → {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres} のように
--     authenticated と service_role だけに X（実行権）が付いていること。
--     anon や =X/（PUBLIC）が現れていたら 20260912063951_definer_anon_execute.sql の
--     revoke / grant をもう一度流す。
--   ふるまいの確認: 会議を開いてタスク化すると今までどおりタスクができ、別の場所で
--     本文を書き換えた直後にタスク化すると「別の場所で更新されています」で止まり、
--     tasks が1件も増えていないこと。
