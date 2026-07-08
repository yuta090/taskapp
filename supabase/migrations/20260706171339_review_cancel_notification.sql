-- =============================================================================
-- レビュー取消時の通知（20260706013654_review_integrity.sql で保留した通知を追加）
-- =============================================================================
-- 20260706013654 の rpc_review_cancel は「通知UIの新規タイプ追加は別途スコープ
-- とする」として通知発行を見送っていた（既存の review 系通知はすべて
-- ACTIONABLE_TYPES に属し「対応が必要」という体裁で描画されるため、流用すると
-- 誤ったアクションUIが出てしまうため）。
--
-- 今回、非アクション型の新通知タイプ 'review_cancelled' を追加し、以下へ通知する:
--   (a) その review の review_approvals で state='pending' のレビュアー全員
--       （依頼が宙に浮いていた人）
--   (b) レビュー依頼者（reviews.created_by）— admin/owner が代理で取り消した
--       場合に依頼者へ知らせるため
--   実行者本人はいずれの宛先からも除外する。
--
-- Scope: rpc_review_cancel の再定義（通知発行の追加）のみ。認可ガード・
-- FOR UPDATE・status遷移・task_events は 20260706013654 の定義を維持する。
-- =============================================================================

CREATE OR REPLACE FUNCTION rpc_review_cancel(
  p_review_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_review reviews%ROWTYPE;
  v_task tasks%ROWTYPE;
  v_is_space_admin boolean;
  v_is_org_owner boolean;
  v_actor_name text;
  v_pending_reviewer uuid;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_review FROM reviews WHERE id = p_review_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Review not found: %', p_review_id;
  END IF;

  -- 認可ガード（監査B2 / 越境IDOR対策）: 呼出元が対象 review の space/org に
  -- アクセス可能か検証する（他RPCと同じ多層防御の前段）。
  IF NOT public.app_can_access_space(v_review.space_id, v_review.org_id) THEN
    RAISE EXCEPTION 'Not authorized to access this review';
  END IF;

  IF v_review.status NOT IN ('open', 'changes_requested') THEN
    RAISE EXCEPTION 'Review cannot be cancelled from status: %', v_review.status;
  END IF;

  -- 認可: レビュー依頼者本人、または対象タスクの space admin、または org owner。
  v_is_space_admin := EXISTS (
    SELECT 1 FROM space_memberships
    WHERE space_id = v_review.space_id AND user_id = v_actor_id AND role = 'admin'
  );
  v_is_org_owner := EXISTS (
    SELECT 1 FROM org_memberships
    WHERE org_id = v_review.org_id AND user_id = v_actor_id AND role = 'owner'
  );

  IF v_review.created_by <> v_actor_id AND NOT v_is_space_admin AND NOT v_is_org_owner THEN
    RAISE EXCEPTION 'Insufficient permissions: only the requester, a space admin, or an org owner can cancel this review';
  END IF;

  SELECT * INTO v_task FROM tasks WHERE id = v_review.task_id;

  UPDATE reviews SET status = 'cancelled', updated_at = now() WHERE id = p_review_id;

  INSERT INTO task_events (org_id, space_id, task_id, actor_id, action, payload)
  VALUES (
    v_review.org_id,
    v_review.space_id,
    v_review.task_id,
    v_actor_id,
    'REVIEW_CANCEL',
    jsonb_build_object('reviewId', p_review_id)
  );

  -- 通知: 宙に浮いていた pending レビュアー + 依頼者へ「対応不要」を知らせる
  -- 非アクション型通知（review_cancelled）。実行者本人は除外する。
  SELECT display_name INTO v_actor_name FROM profiles WHERE id = v_actor_id;

  FOR v_pending_reviewer IN
    SELECT reviewer_id FROM review_approvals
    WHERE review_id = p_review_id AND state = 'pending'
  LOOP
    IF v_pending_reviewer <> v_actor_id THEN
      PERFORM _create_task_notification(
        v_review.org_id,
        v_review.space_id,
        v_pending_reviewer,
        'review_cancelled',
        format('review_cancelled:%s:%s', p_review_id, v_pending_reviewer),
        jsonb_build_object(
          'task_id', v_review.task_id,
          'task_title', v_task.title,
          'title', format('レビュー取消: 「%s」', v_task.title),
          'message', 'このレビュー依頼は取り消されました。対応は不要です。',
          'from_user_name', v_actor_name,
          'link', format('/%s/project/%s?task=%s', v_review.org_id, v_review.space_id, v_review.task_id)
        )
      );
    END IF;
  END LOOP;

  IF v_review.created_by IS NOT NULL AND v_review.created_by <> v_actor_id THEN
    PERFORM _create_task_notification(
      v_review.org_id,
      v_review.space_id,
      v_review.created_by,
      'review_cancelled',
      format('review_cancelled:%s:%s', p_review_id, v_review.created_by),
      jsonb_build_object(
        'task_id', v_review.task_id,
        'task_title', v_task.title,
        'title', format('レビュー取消: 「%s」', v_task.title),
        'message', 'このレビュー依頼は取り消されました。対応は不要です。',
        'from_user_name', v_actor_name,
        'link', format('/%s/project/%s?task=%s', v_review.org_id, v_review.space_id, v_review.task_id)
      )
    );
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION rpc_review_cancel(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION rpc_review_cancel(uuid) TO authenticated;

-- =============================================================================
-- 検証（適用後の想定手動確認）:
--
--   A) pending レビュアーへの通知:
--      status='open' の review（レビュアー2名、うち1名 pending・1名 approved）を
--      created_by 本人が rpc_review_cancel で取り消す。
--      → pending だったレビュアーの notifications に type='review_cancelled' が
--        1件作成されること（approved 済みのレビュアーには作成されないこと）。
--
--   B) 依頼者への通知（代理取消）:
--      space admin が自分以外の created_by を持つ review を取り消す。
--      → created_by 本人の notifications に type='review_cancelled' が
--        作成されること。
--
--   C) 実行者本人の除外:
--      created_by 本人が自分の review を取り消す。
--      → created_by 宛の通知は作成されないこと（実行者=依頼者のため）。
--      created_by 本人が自分が pending レビュアーでもある review を取り消す
--      （通常は起きないが念のため）。 → 実行者宛の通知は作成されないこと。
--
--   D) 再依頼→再取消の再浮上:
--      同一 task で rpc_review_open → rpc_review_cancel を2回繰り返す。
--      → 2回目も dedupe_key が同一のため ON CONFLICT DO UPDATE で
--        read_at がリセットされ、通知が未読として再浮上すること。
-- =============================================================================
