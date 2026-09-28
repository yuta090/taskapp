-- =============================================================================
-- 社内承認が全員そろったら、そのままタスクを完了にする
--
-- 問題（2026-09-18 本番で発覚）:
--   承認（画面の rpc_review_approve / 道具の rpc_review_approve_as → 本体 _review_approve_impl）は、
--   承認の状態と reviews.status を変えるだけで、タスクの状態は「社内承認中」のまま置いていた。
--   一方で DB のトリガー enforce_review_gate は、承認がそろうまでタスクを完了にさせない。
--   その結果、承認を頼まれた人が受信トレイで「完了」にしても断られ、「承認」を押しても
--   ステータスは変わらない、という行き止まりになっていた（実際に本番で起きた）。
--
-- 対応（ユーザーの決定・2026-09-18: 「自動で完了にする」）:
--   _review_approve_impl を 20260915123012_review_result_notify.sql の定義のまま写し、
--   承認がそろって reviews を approved にした直後に、タスクを完了にする節を足す。
--     - 完了にするのは、まだ完了しておらず、決定事項が未決でもないときだけ
--       （未決の決定事項タスクは enforce_review_gate が done を拒む。先に「決定にする」が要る）
--     - 予期しない理由で完了にできなくても、承認そのものは成功させる（begin … exception で包み warning）
--     - 完了にしたときは audit_logs に task.status_changed を1行残す（画面の変更履歴に出す。
--       誰も触っていないのに完了になったように見えるのを防ぐ）。actor は承認した人
--     - task_events の REVIEW_APPROVE の payload に autoCompleted を足す
--     - 承認そろいのお知らせの文面を、完了にしたかどうかで書き分ける
--     - 戻り値に taskCompleted を足す（画面がその場で「完了」と出せる）
--   すでに承認済みの人がもう一度押した経路（alreadyApproved）は、状態を変えないので今までどおり。
--
-- 変えないもの: 呼んだ人の確かめ・認可ガード・承認の状態の変え方・ボール・実行権・
--   差し戻し（_review_block_impl）・画面と道具の入口（rpc_review_approve / _as）。
--
-- 確認: 今の定義が土台（20260915123012_review_result_notify.sql）か本 migration のどちらでもなければ止める
--       （本番だけにある手直しを上書きしないため）。
-- ロック: 表は変えない（関数の置き換えだけ）。待つのは5秒まで。
-- 冪等: create or replace。2回流しても同じ。
-- 検証: supabase/tests/run_review_auto_complete.sh・scripts/verify-migrations-from-scratch.sh
-- =============================================================================

set local lock_timeout = '5s';

-- 確認: 今の定義が土台か本 migration の定義でなければ止める
do $$
declare
  v_md5 text;
  v_sig text := 'public._review_approve_impl(uuid,uuid,uuid)';
  v_base_md5 text := 'dd76aa93676fd8d5312e6c5ccf86a9a7';  -- 20260915123012_review_result_notify.sql
  v_new_md5 text := 'd2fe6fff93e6b932f4a641249615ac73';                        -- 本 migration
begin
  select md5(p.prosrc) into v_md5 from pg_proc p where p.oid = to_regprocedure(v_sig);
  if v_md5 is null or v_md5 not in (v_base_md5, v_new_md5) then
    raise exception 'review auto complete: %s の今の定義が、土台にした migration の定義と違います（md5 %）',
      v_sig, coalesce(v_md5, '関数が無い');
  end if;
end $$;

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
  -- 承認がそろって、このお知らせと同じトランザクションでタスクを完了にしたか
  v_auto_done boolean := false;
  v_actor_role text;
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

    -- 承認がそろったら、そのままタスクを完了にする。
    -- そろうまで完了にできない決まり（enforce_review_gate）があるので、そろった瞬間に
    -- 誰かが手で完了を押し直す形になっていた。押し忘れると「社内承認中」のまま残る。
    -- 完了にしないのは次の場合。どちらも承認だけ通してタスクはそのままにする:
    --   - すでに完了している
    --   - 決定事項のタスクで、まだ決まっていない（先に「決定にする」が要る）
    IF v_task.status <> 'done'
       AND NOT (v_task.type = 'spec' AND v_task.decision_state = 'considering') THEN
      -- 予期しない理由（別のトリガーに断られた等）で完了にできなくても、承認そのものは成功させる
      BEGIN
        UPDATE tasks SET status = 'done' WHERE id = p_task_id;
        v_auto_done := true;

        -- 画面の変更履歴に出す（人が押していない変更なので、残さないと「勝手に完了になった」に見える）
        SELECT om.role INTO v_actor_role
          FROM org_memberships om
         WHERE om.org_id = v_task.org_id AND om.user_id = v_actor_id;

        INSERT INTO audit_logs (
          org_id, space_id, actor_id, actor_role, event_type, target_type, target_id,
          summary, data_before, data_after
        ) VALUES (
          v_task.org_id,
          v_task.space_id,
          v_actor_id,
          v_actor_role,
          'task.status_changed',
          'task',
          p_task_id,
          '社内承認がそろったので完了にしました',
          jsonb_build_object('status', v_task.status, 'milestone_id', v_task.milestone_id),
          jsonb_build_object('status', 'done', 'milestone_id', v_task.milestone_id)
        );
      EXCEPTION WHEN OTHERS THEN
        v_auto_done := false;
        RAISE WARNING 'review auto complete: 承認はそろいましたがタスクを完了にできませんでした（task %）: % (%)',
          p_task_id, SQLERRM, SQLSTATE;
      END;
    END IF;
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
    jsonb_build_object('allApproved', v_all_approved, 'autoCompleted', v_auto_done)
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
      IF v_auto_done THEN
        v_title := format('社内承認がそろい、完了にしました: 「%s」', v_task.title);
        v_message := 'すべての承認者が承認したので、タスクを完了にしました。';
      ELSIF v_task.status = 'done' THEN
        v_title := format('社内承認がそろいました: 「%s」', v_task.title);
        v_message := 'すべての承認者が承認しました。このタスクはすでに完了しています。';
      ELSIF v_task.type = 'spec' AND v_task.decision_state = 'considering' THEN
        v_title := format('社内承認がそろいました: 「%s」', v_task.title);
        v_message := 'すべての承認者が承認しました。決定事項がまだ決まっていないので、完了にはしていません。先に「決定にする」を押してください。';
      ELSE
        v_title := format('社内承認がそろいました: 「%s」', v_task.title);
        v_message := 'すべての承認者が承認しました。次の作業に進めます。';
      END IF;
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
          'task_completed', v_auto_done,
          'title', v_title,
          'message', v_message
        )
      );
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'review result notify: 承認のお知らせを作れませんでした（task %）: % (%)', p_task_id, SQLERRM, SQLSTATE;
  END;

  RETURN jsonb_build_object('ok', true, 'allApproved', v_all_approved, 'taskCompleted', v_auto_done);
END;
$$;

-- 末尾の確認: 実行権・SECURITY DEFINER・search_path が想定どおりか（create or replace では変わらないが、念のため）
do $$
declare
  v_ok boolean;
begin
  select p.prosecdef and p.proconfig @> array['search_path=public']
    into v_ok
    from pg_proc p
   where p.oid = to_regprocedure('public._review_approve_impl(uuid,uuid,uuid)');
  if not coalesce(v_ok, false) then
    raise exception 'review auto complete: _review_approve_impl の SECURITY DEFINER / search_path が想定と違います';
  end if;
end $$;
