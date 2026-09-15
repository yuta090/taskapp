-- =============================================================================
-- 社内承認で「承認」「差し戻し」をしたとき、依頼した人と担当者の受信トレイにお知らせを届ける
--
-- 問題（2026-09-15 develop・本番で確認）:
--   承認（画面の rpc_review_approve / CLI の rpc_review_approve_as → 本体 _review_approve_impl）は、承認の状態を変えて
--   task_events に REVIEW_APPROVE を残すだけで、お知らせを作っていなかった。依頼した人は承認されたことに気づけない。
--   差し戻し（rpc_review_block / rpc_review_block_as → 本体 _review_block_impl）は、依頼した人（reviews.created_by）
--   だけに _create_task_notification でお知らせを作っていた。担当者が依頼した人と別だと、担当者には届かない。
--   しかも _create_task_notification は同じキーの行があると書き直すだけ（ON CONFLICT DO UPDATE）なので、同じタスクで
--   2回目に差し戻すと、プッシュ（insert のときだけ動く notifications_push_dispatch）も、即時メール
--   （immediate_email_sent_at が立ったまま）も出なかった。
--
-- 対応:
--   節 1: _review_approve_impl を 20260912134823_mcp_rpc_as.sql の定義のまま写し、DECLARE の変数と、最後のお知らせの節を
--         足す。承認の状態が実際に変わったときだけ（既に承認済みで何もしない経路では作らない）、依頼した人と担当者に
--         type = 'review_approved' を1人1行作る。キーは review_approve:<依頼>:<承認した人>:<宛先>。
--         文面: 全員そろった →「社内承認がそろいました: 「タスク名」」/ まだ残りがいる →「○○さんが承認しました: 「タスク名」」
--         と残りの人数。payload は task_id・task_title・from_user_name（表示名。空なら null）・all_approved・title・message。
--         残りの人数は保留中（state = 'pending'）の人だけ数える（差し戻した人はもう返事を出しているので数えない）。
--         message は、保留中の人がいれば「ほかの承認者の返事を待っています（残りN人）。」、保留中は0人で差し戻し中の人が
--         いれば「差し戻している承認者がいます。差し戻しの内容を確認してください。」。「そろったか」の判定（全員 approved）は同じ。
--   節 2: _review_block_impl を同じく写し、お知らせの部分（依頼した人だけ）を、依頼した人と担当者への type = 'ball_passed'
--         に置き換える。キーは review_block:<依頼>:<宛先>（依頼した人のキーは今までと同じ形）。payload も今までと同じ。
--         あわせて、差し戻した本人が同じ依頼で出した承認のお知らせ（type = 'review_approved'・キーが
--         review_approve:<依頼>:<差し戻した人>:）のうち、未読の行を消す。承認してから押し間違いに気づいて差し戻すと、依頼した
--         人の受信トレイに「社内承認がそろいました」と「差し戻し」が両方未読で並ぶため。既読の行は、読んだ人の記録なので残す。
--         ほかの承認者の承認のお知らせ・ほかの依頼の承認のお知らせは消さない。
--   共通:
--     - 宛先は依頼した人と担当者（tasks.assignee_id）の重複なし。操作した本人は除く。社内の人だけ
--       （組織の役割が owner / admin / member で、その space の役割が client / vendor でない。space の役割が無い社内メンバーは
--       editor 扱い＝ app_is_space_internal と同じ考え方を、呼んだ人ではなく宛先の user_id で判定する）。
--       社内承認は社内の用件なので、担当者が相手先・協力会社なら送らない。判定は関数の中に書き、補助関数は作らない。
--     - 同じキーの行があれば消してから作る。書き直しではプッシュ・即時メールが出ないため、新しい出来事として作り直す
--       （前のお知らせの既読・対応済みの記録は残らない）。
--     - お知らせの節は begin … exception で包む。お知らせを書けなくても承認・差し戻しそのものは成功させ、warning だけ出す
--       （その場合は消した行も元に戻り、前のお知らせが残る）。
--     - 呼んだ人の確かめ・承認の状態の変え方・ボール・task_events・戻り値は変えない。実行権（外からは誰も呼べない）は
--       create or replace では変わらない。画面の rpc_review_* と道具用の rpc_review_*_as は同じ本体を呼ぶので書き換えない。
--
-- 確認: 2つの関数の今の定義が、土台（20260912134823_mcp_rpc_as.sql の定義）か本 migration の定義のどちらでもなければ止める
--       （本番だけにある手直しを上書きしないため。止まったら pg_get_functiondef と土台のファイルを見比べる）。
--       末尾で、本文・SECURITY DEFINER・search_path・実行権が想定どおりかを確かめる。
-- ロック: 表は変えない（関数の置き換えだけ）。待つのは5秒まで。
-- 冪等: create or replace。2回流しても同じ。
-- 適用の順番: 本 migration を先に当て、そのあと画面側（src/lib/notifications の review_approved の配信・見出し）を出す。
--   本 migration だけが先に出ている間も、承認・差し戻しは今までどおり動く。review_approved は受信トレイに出るだけで、
--   プッシュ・メールは出ない（delivery.ts の getDeliveryPolicy は知らない種類を鳴らさない）。担当者あての差し戻しは
--   今までと同じ ball_passed なので、すぐにプッシュ・即時メールの対象になる。
-- 検証: supabase/tests/run_review_result_notify.sh（RED=1 で、本 migration が無いと失敗することも確かめる）・
--       scripts/verify-migrations-from-scratch.sh
-- =============================================================================

set local lock_timeout = '5s';

-- 確認: 2つの関数の今の定義が、土台（20260912134823_mcp_rpc_as.sql）か本 migration の定義でなければ止める
do $$
declare
  v_bad text := '';
  v_md5 text;
  r     record;
begin
  for r in select * from (values
      ('public._review_approve_impl(uuid,uuid,uuid)', 'fd3140e13174335adce627b7a5e3b970', 'dd76aa93676fd8d5312e6c5ccf86a9a7'),
      ('public._review_block_impl(uuid,uuid,text,uuid)', 'cf8e7e8cc12b9bc563f34d8cc990ce9b', '75e04b0b8be834aa4d822d11dcfdf0b3')
    ) v(sig, base_md5, new_md5)
  loop
    select md5(p.prosrc) into v_md5
      from pg_proc p
     where p.oid = to_regprocedure(r.sig);
    if v_md5 is null or v_md5 not in (r.base_md5, r.new_md5) then
      v_bad := v_bad || format(' %s（md5 %s）;', r.sig, coalesce(v_md5, '関数が無い'));
    end if;
  end loop;

  if v_bad <> '' then
    raise exception 'review result notify: 次の関数の今の定義が、土台にした migration の定義と違います:%', v_bad;
  end if;
end $$;

-- =============================================================================
-- 節 1: _review_approve_impl（土台: 20260912134823_mcp_rpc_as.sql の節 6。変えたのは DECLARE の7行と、最後のお知らせの節だけ）
-- =============================================================================
create or replace function public._review_approve_impl(
  p_actor uuid,
  p_task_id uuid,
  p_meeting_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  v_task tasks%ROWTYPE;
  v_actor_id uuid;
  v_review_id uuid;
  v_review_space_id uuid;
  v_review_org_id uuid;
  v_all_approved boolean;
  v_updated_rows int;
  v_requester_id uuid;
  v_actor_name text;
  v_remaining int;
  v_blocked int;
  v_title text;
  v_message text;
  v_recipient uuid;
BEGIN
  v_actor_id := p_actor;
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Get task
  SELECT * INTO v_task FROM tasks WHERE id = p_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found: %', p_task_id;
  END IF;

  -- Get review (+ space/org for the authorization anchor) and LOCK the row.
  -- Bug 1: without this lock, two reviewers approving the last two pending
  -- approvals concurrently can both observe v_all_approved=false under READ
  -- COMMITTED (each transaction reads review_approvals before the other's
  -- commit), leaving reviews.status stuck at 'open' even though every
  -- approval is 'approved'. FOR UPDATE serializes the two transactions so
  -- the second one re-reads a consistent state.
  SELECT id, space_id, org_id
  INTO v_review_id, v_review_space_id, v_review_org_id
  FROM reviews WHERE task_id = p_task_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No review found for task: %', p_task_id;
  END IF;

  -- 認可ガード（監査B2 / 越境IDOR対策）: 呼出元が対象 review の space/org に
  -- 書き込める役割（社内の admin / editor）か検証する。既存の reviewer_id チェックより前段の多層防御。
  IF NOT public._actor_can_write_space(v_actor_id, v_review_space_id, v_review_org_id) THEN
    RAISE EXCEPTION 'Not authorized to access this review';
  END IF;

  -- Update current user's approval. `AND state <> 'approved'` makes a
  -- re-run against an already-approved reviewer a no-op (Bug 4: idempotency).
  UPDATE review_approvals
  SET state = 'approved', updated_at = now()
  WHERE review_id = v_review_id AND reviewer_id = v_actor_id AND state <> 'approved';

  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;

  IF v_updated_rows = 0 THEN
    -- Either the caller is not a reviewer on this review, or they already
    -- approved. Disambiguate to preserve the original error for the former.
    IF NOT EXISTS (
      SELECT 1 FROM review_approvals
      WHERE review_id = v_review_id AND reviewer_id = v_actor_id
    ) THEN
      RAISE EXCEPTION 'User is not a reviewer for this task';
    END IF;

    -- Already approved: return current state without re-logging to
    -- task_events (Bug 4).
    SELECT NOT EXISTS (
      SELECT 1 FROM review_approvals
      WHERE review_id = v_review_id AND state != 'approved'
    ) INTO v_all_approved;

    RETURN jsonb_build_object('ok', true, 'allApproved', v_all_approved, 'alreadyApproved', true);
  END IF;

  -- Check if all reviewers approved (safe under the FOR UPDATE lock above).
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

  -- 承認のお知らせ: 依頼した人と担当者（重複なし・承認した本人は除く・社内の人だけ）に1人1行。
  -- 社内の人 = 組織の役割が owner / admin / member で、その space の役割が client / vendor でない
  -- （space の役割が無い社内メンバーは editor 扱い。app_is_space_internal と同じ考え方を宛先の user_id で判定する）。
  -- 同じキーの行は消してから作る（書き直しではプッシュ・即時メールが出ないため）。
  -- お知らせを書けなくても承認そのものは成功させる（warning だけ出す。消した行も元に戻る）
  BEGIN
    SELECT created_by INTO v_requester_id FROM reviews WHERE id = v_review_id;
    SELECT nullif(btrim(display_name), '') INTO v_actor_name FROM profiles WHERE id = v_actor_id;

    IF v_all_approved THEN
      v_title := format('社内承認がそろいました: 「%s」', v_task.title);
      v_message := 'すべての承認者が承認しました。次の作業に進めます。';
    ELSE
      -- 残りの人数は保留中（pending）の人だけ数える。差し戻した人（blocked）は、もう返事を出しているので数えない。
      -- 保留中の人がいなくて、まだそろっていない理由が差し戻しなら、待つのではなく差し戻しの内容を見るよう伝える
      SELECT count(*) FILTER (WHERE state = 'pending'),
             count(*) FILTER (WHERE state = 'blocked')
        INTO v_remaining, v_blocked
        FROM review_approvals
       WHERE review_id = v_review_id;
      v_title := format('%sさんが承認しました: 「%s」', coalesce(v_actor_name, 'メンバー'), v_task.title);
      IF v_remaining = 0 AND v_blocked > 0 THEN
        v_message := '差し戻している承認者がいます。差し戻しの内容を確認してください。';
      ELSE
        v_message := format('ほかの承認者の返事を待っています（残り%s人）。', v_remaining);
      END IF;
    END IF;

    FOR v_recipient IN
      SELECT DISTINCT u.user_id
        FROM unnest(ARRAY[v_requester_id, v_task.assignee_id]) AS u(user_id)
       WHERE u.user_id IS NOT NULL
         AND u.user_id <> v_actor_id
         AND EXISTS (
           SELECT 1 FROM org_memberships om
            WHERE om.org_id = v_task.org_id
              AND om.user_id = u.user_id
              AND om.role IN ('owner', 'admin', 'member')
         )
         AND coalesce((
           SELECT sm.role FROM space_memberships sm
            WHERE sm.space_id = v_task.space_id
              AND sm.user_id = u.user_id
         ), 'editor') NOT IN ('client', 'vendor')
    LOOP
      DELETE FROM notifications
       WHERE to_user_id = v_recipient
         AND channel = 'in_app'
         AND dedupe_key = format('review_approve:%s:%s:%s', v_review_id, v_actor_id, v_recipient);

      INSERT INTO notifications (org_id, space_id, to_user_id, channel, type, dedupe_key, payload)
      VALUES (
        v_task.org_id,
        v_task.space_id,
        v_recipient,
        'in_app',
        'review_approved',
        format('review_approve:%s:%s:%s', v_review_id, v_actor_id, v_recipient),
        jsonb_build_object(
          'task_id', p_task_id,
          'task_title', v_task.title,
          'from_user_name', v_actor_name,
          'all_approved', v_all_approved,
          'title', v_title,
          'message', v_message
        )
      );
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'review result notify: 承認のお知らせを作れませんでした（task %）: % (%)', p_task_id, SQLERRM, SQLSTATE;
  END;

  RETURN jsonb_build_object('ok', true, 'allApproved', v_all_approved);
END;
$$;

-- =============================================================================
-- 節 2: _review_block_impl（土台: 20260912134823_mcp_rpc_as.sql の節 7。変えたのは DECLARE の1行と、最後のお知らせの節だけ）
-- =============================================================================
create or replace function public._review_block_impl(
  p_actor uuid,
  p_task_id uuid,
  p_blocked_reason text,
  p_meeting_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  v_task tasks%ROWTYPE;
  v_actor_id uuid;
  v_review_id uuid;
  v_review_space_id uuid;
  v_review_org_id uuid;
  v_requester_id uuid;
  v_actor_name text;
  v_updated_rows int;
  v_recipient uuid;
BEGIN
  v_actor_id := p_actor;
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Get task
  SELECT * INTO v_task FROM tasks WHERE id = p_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found: %', p_task_id;
  END IF;

  -- Get review (+ requester for the ball hand-back notification, + space/org
  -- anchor) and LOCK the row — same rationale as rpc_review_approve: without
  -- it, a block racing against the last concurrent approvals could observe
  -- a stale approval count.
  SELECT id, created_by, space_id, org_id
  INTO v_review_id, v_requester_id, v_review_space_id, v_review_org_id
  FROM reviews WHERE task_id = p_task_id
  FOR UPDATE;
  IF v_review_id IS NULL THEN
    RAISE EXCEPTION 'No review found for task: %', p_task_id;
  END IF;

  -- 認可ガード（監査B2 / 越境IDOR対策）: 呼出元が対象 review の space/org に
  -- 書き込める役割（社内の admin / editor）か検証する。既存の reviewer_id チェックより前段の多層防御。
  IF NOT public._actor_can_write_space(v_actor_id, v_review_space_id, v_review_org_id) THEN
    RAISE EXCEPTION 'Not authorized to access this review';
  END IF;

  -- Update current user's approval to blocked. Only counts as a real change
  -- (and triggers ball hand-back / notification / task_events below) if the
  -- state or the reason actually changed — a double-submit of the same
  -- reason is a no-op (Bug 4: symmetry with rpc_review_approve).
  UPDATE review_approvals
  SET state = 'blocked', blocked_reason = p_blocked_reason, updated_at = now()
  WHERE review_id = v_review_id
    AND reviewer_id = v_actor_id
    AND (state <> 'blocked' OR blocked_reason IS DISTINCT FROM p_blocked_reason);

  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;

  IF v_updated_rows = 0 THEN
    IF NOT EXISTS (
      SELECT 1 FROM review_approvals
      WHERE review_id = v_review_id AND reviewer_id = v_actor_id
    ) THEN
      RAISE EXCEPTION 'User is not a reviewer for this task';
    END IF;

    -- No actual change (identical repeat submission): idempotent no-op.
    RETURN jsonb_build_object('ok', true, 'alreadyBlocked', true);
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

  -- 差し戻しのお知らせ: 依頼した人と担当者（重複なし・差し戻した本人は除く・社内の人だけ）に1人1行。
  -- 社内の人の判定は _review_approve_impl と同じ。依頼した人のキーは今までと同じ形（review_block:<依頼>:<宛先>）。
  -- 同じキーの行は消してから作る（2回目以降の差し戻しでもプッシュ・即時メールが出るように）。
  -- お知らせを書けなくても差し戻しそのものは成功させる（warning だけ出す。消した行も元に戻る）
  SELECT display_name INTO v_actor_name FROM profiles WHERE id = v_actor_id;

  BEGIN
    -- 差し戻した本人が同じ依頼で出した承認のお知らせのうち、未読の行を消す。承認してから差し戻すと、依頼した人の
    -- 受信トレイに「社内承認がそろいました」と「差し戻し」が両方未読で並ぶため。読んだ行は読んだ人の記録なので残す。
    -- 承認したときの宛先（依頼した人・その時の担当者）は今の担当者と違うことがあるので、宛先では絞らない。
    -- space_id で絞るのは notifications_space_idx で引くため（承認のお知らせはタスクの space_id で作っており、
    -- タスクを別のプロジェクトへ移す処理は無い）
    DELETE FROM notifications
     WHERE space_id = v_task.space_id
       AND channel = 'in_app'
       AND type = 'review_approved'
       AND read_at IS NULL
       AND dedupe_key LIKE format('review_approve:%s:%s:%%', v_review_id, v_actor_id);

    FOR v_recipient IN
      SELECT DISTINCT u.user_id
        FROM unnest(ARRAY[v_requester_id, v_task.assignee_id]) AS u(user_id)
       WHERE u.user_id IS NOT NULL
         AND u.user_id <> v_actor_id
         AND EXISTS (
           SELECT 1 FROM org_memberships om
            WHERE om.org_id = v_task.org_id
              AND om.user_id = u.user_id
              AND om.role IN ('owner', 'admin', 'member')
         )
         AND coalesce((
           SELECT sm.role FROM space_memberships sm
            WHERE sm.space_id = v_task.space_id
              AND sm.user_id = u.user_id
         ), 'editor') NOT IN ('client', 'vendor')
    LOOP
      DELETE FROM notifications
       WHERE to_user_id = v_recipient
         AND channel = 'in_app'
         AND dedupe_key = format('review_block:%s:%s', v_review_id, v_recipient);

      INSERT INTO notifications (org_id, space_id, to_user_id, channel, type, dedupe_key, payload)
      VALUES (
        v_task.org_id,
        v_task.space_id,
        v_recipient,
        'in_app',
        'ball_passed',
        format('review_block:%s:%s', v_review_id, v_recipient),
        jsonb_build_object(
          'task_id', p_task_id,
          'task_title', v_task.title,
          'title', format('差し戻し: 「%s」', v_task.title),
          'message', format('修正依頼: %s', p_blocked_reason),
          'from_user_name', v_actor_name,
          'ball', 'internal'
        )
      );
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'review result notify: 差し戻しのお知らせを作れませんでした（task %）: % (%)', p_task_id, SQLERRM, SQLSTATE;
  END;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- =============================================================================
-- 末尾の確認（何も変えない）: 2つの関数の本文・SECURITY DEFINER・search_path・実行権が想定どおり。違えば止める。
--   実行権は public / anon / authenticated / service_role の順（土台と同じく、外からは誰も呼べない）。
-- =============================================================================
do $$
declare
  v_bad text := '';
  v_got text;
  r     record;
begin
  for r in select * from (values
      ('public._review_approve_impl(uuid,uuid,uuid)', 'dd76aa93676fd8d5312e6c5ccf86a9a7', 'false/false/false/false'),
      ('public._review_block_impl(uuid,uuid,text,uuid)', '75e04b0b8be834aa4d822d11dcfdf0b3', 'false/false/false/false')
    ) v(sig, want_md5, want_rights)
  loop
    select format('%s:%s:%s:%s/%s/%s/%s', md5(p.prosrc), p.prosecdef::text, array_to_string(p.proconfig, ';'),
                  has_function_privilege('public', p.oid, 'execute')::text,
                  has_function_privilege('anon', p.oid, 'execute')::text,
                  has_function_privilege('authenticated', p.oid, 'execute')::text,
                  has_function_privilege('service_role', p.oid, 'execute')::text)
      into v_got
      from pg_proc p
     where p.oid = to_regprocedure(r.sig);
    if v_got is distinct from format('%s:true:search_path=public:%s', r.want_md5, r.want_rights) then
      v_bad := v_bad || format(' %s=%s;', r.sig, coalesce(v_got, 'なし'));
    end if;
  end loop;

  if v_bad <> '' then
    raise exception 'review result notify: 想定と違います:%', v_bad;
  end if;
end $$;

-- =============================================================================
-- ロールバック（手で流す）
--   1) 土台の定義に戻す: 20260912134823_mcp_rpc_as.sql の節 6 の「create or replace function public._review_approve_impl(」から
--      直後の「$$;」までと、節 7 の「create or replace function public._review_block_impl(」から直後の「$$;」までを、
--      そのまま1トランザクションで流す（実行権は create or replace では変わらない）。取り出す例:
--        awk '/^create or replace function public\._review_(approve|block)_impl\(/{f=1} f{print} f && /^\$\$;$/{f=0}' \
--          supabase/migrations/20260912134823_mcp_rpc_as.sql > rollback_review_result_notify.sql
--      戻したあと、両関数の md5(prosrc) が fd3140e13174335adce627b7a5e3b970 / cf8e7e8cc12b9bc563f34d8cc990ce9b になる。
--   2) （任意）承認のお知らせを消す: delete from public.notifications where type = 'review_approved';
--   戻せないもの: 本 migration の間に作り直したお知らせの、前の行（id・既読・対応済み・即時メールを送った時刻）は戻らない。
--     承認のあとの差し戻しで消した、未読の承認のお知らせ（review_approved）も戻らない。
--     担当者あての差し戻しのお知らせは、依頼した人あてと同じ type・キーの形なので、区別して消さない。
-- =============================================================================
