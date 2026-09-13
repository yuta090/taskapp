-- 確定した時点の内容を「控え」として見分けられるようにする
--
-- ユーザーの要望:「確定した資料は凍結のチェックがつき、一覧でもすぐにわかるように」。
-- 相談の結果、**ページ全体を編集できなくする形は採らない**（長い資料は一部しか確定しないので、
-- ページを丸ごと閉じると仕事が止まる。自動保存とも相性が悪い）。代わりに
--   - 確定した瞬間の本文を控えとして残す
--   - あとから本文が変わったら分かるようにする
-- という形にする。ユーザー確認済み（「控えが残ればよい」）。
--
-- 控えそのものは既に取れている。`rpc_set_spec_state` は決定行を書き足す**前**の本文を
-- `wiki_page_versions` に入れている。足りないのは「これは確定時点のものだ」という名札だけ。
--
-- この migration ですること:
--   1. `wiki_page_versions` に `kind`（autosave / decided / implemented）と `task_id` を足す
--   2. `rpc_set_spec_state` が名札を付けて控えを取るようにする
--   3. 決定行に、その札（タスク）へのリンクを付ける。絵文字はやめる
--   4. 名札を偽れないよう、画面から入れられる列を限る
--   5. 読み取りの取りこぼしを塞ぐ（本文を読んでから書くまでの間に行をロックする）

-- ---------------------------------------------------------------------------
-- 1. 版に名札を付ける
-- ---------------------------------------------------------------------------

ALTER TABLE public.wiki_page_versions
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'autosave';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'wiki_page_versions_kind_chk'
  ) THEN
    ALTER TABLE public.wiki_page_versions
      ADD CONSTRAINT wiki_page_versions_kind_chk
      CHECK (kind IN ('autosave', 'decided', 'implemented'));
  END IF;
END $$;

-- どの札の確定でこの控えが取られたか。札が消えても控えは残す（set null）
ALTER TABLE public.wiki_page_versions
  ADD COLUMN IF NOT EXISTS task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.wiki_page_versions.kind IS
  '版の種類。autosave=本文の自動保存でできた控え / decided・implemented=札を確定したときの控え（確定時点の内容）';
COMMENT ON COLUMN public.wiki_page_versions.task_id IS
  'kind が autosave でないとき、その確定を行った札（タスク）';

-- 確定の控えだけを新しい順に引く用（自動保存の版が大量にあるので、部分索引で分ける）
CREATE INDEX IF NOT EXISTS wiki_page_versions_decided_idx
  ON public.wiki_page_versions (page_id, created_at DESC)
  WHERE kind <> 'autosave';

-- ---------------------------------------------------------------------------
-- 4. 名札を偽れないようにする
-- ---------------------------------------------------------------------------
-- 画面（useWikiPages.updatePage）と CLI（wiki_update）は、版を作るとき
-- org_id / page_id / title / body / created_by の5列しか送っていない。
-- 表ごと insert を許していると、細工した呼び出しで kind='decided' の偽の控えを作れる。
-- 列を限って許可し、kind と task_id は SECURITY DEFINER の RPC（所有者として動く）だけが
-- 書けるようにする。RLS のポリシー自体は変えない（誰が入れられるかの条件はそのまま）。
REVOKE INSERT ON public.wiki_page_versions FROM authenticated;
GRANT INSERT (org_id, page_id, title, body, created_by)
  ON public.wiki_page_versions TO authenticated;

-- insert だけ列で絞っても、update が表単位のままだと意味がない。
-- 5列で自動保存の控えを作ったあと `update … set kind='decided'` で名札を後付けできてしまう。
-- 控えは作ったら変えない・消さないものなので、update / delete ごと取り上げる。
-- 画面にも CLI にも版を更新・削除する経路は無い（ページを消したときの連鎖削除は
-- 外部キーの cascade が行うので、この権限とは無関係）。
REVOKE UPDATE, DELETE ON public.wiki_page_versions FROM authenticated;
-- 権限が無ければポリシーは効かないが、残っていると「更新できる」と読めて紛らわしい。
-- 消しておけば、将来うっかり grant を戻しても既定の拒否で守られる。
DROP POLICY IF EXISTS wiki_page_versions_update_member ON public.wiki_page_versions;
DROP POLICY IF EXISTS wiki_page_versions_delete_member ON public.wiki_page_versions;

-- ---------------------------------------------------------------------------
-- 2 / 3 / 5. rpc_set_spec_state
-- ---------------------------------------------------------------------------
-- 土台は 20260911143112_space_role_boundary.sql の定義。変更点は4つだけで、
-- 認可・検証・task_events の中身は一切変えていない。
--   a. wiki_pages の行を FOR UPDATE でロックしてから読む（読んでから書くまでの間に
--      他の保存が入ると、その内容を巻き戻してしまうため）
--   b. 控えに kind と task_id を入れる
--   c. 決定行にその札へのリンクを付ける
--   d. 決定行の絵文字をやめる（この repo の決まり）
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
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_task FROM tasks WHERE id = p_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found: %', p_task_id;
  END IF;

  -- 認可ガード（監査B2 / 越境IDOR対策）
  IF NOT public.app_can_write_space(v_task.space_id, v_task.org_id) THEN
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
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_set_spec_state(uuid, text, uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_set_spec_state(uuid, text, uuid, text) TO authenticated, service_role;

-- 適用後の確認:
--   1. 「仕様書として扱う」のページに紐づく札を「決定にする」→ ページの末尾に
--      「決定: <札の題名> (YYYY/MM/DD)」が入り、題名がリンクになっていて押すと札が開く。
--   2. `select kind, task_id from wiki_page_versions where page_id = '<ページ>' order by created_at desc limit 3;`
--      → 最新の1件が kind='decided' / task_id=<札> で、その body に決定行が**入っていない**こと。
--   3. 画面から `wiki_page_versions` に kind='decided' で insert しようとすると権限エラーになること
--      （自動保存・版の復元・CLI の wiki_update はこれまでどおり通ること）。
--   4. 同じページの2つの札をほぼ同時に確定して、決定行が2行とも残ること。
