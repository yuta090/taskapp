-- =============================================================================
-- レビュー整合性の是正（同時最終承認・キャンセル導線・完了ガードの拡張・冪等化）
-- =============================================================================
-- 対応する4件のバグ:
--
-- 1. [P2] 同時最終承認で reviews.status が approved に遷移し損ねる
--    rpc_review_approve は「自分の approval を UPDATE → 全員approved か集計SELECT
--    → reviews.status 更新」の read-then-write で、reviews 行のロックが無い。
--    最後の未承認者2名が同時承認すると READ COMMITTED 下で双方
--    v_all_approved=false になり、全員承認済みなのに status='open' のまま滞留する。
--    → reviews 行を SELECT ... FOR UPDATE でロックし、最終承認判定を直列化する。
--
-- 2. [P2] 指名レビュアーがスペースから外れるとレビューがUI上復旧不能
--    rpc_review_approve/block は本人しか承認/差戻しできず、UI
--    （TaskReviewSection）の承認/差戻しボタンは isCurrentUserReviewer のみに
--    表示される。open/changes_requested のまま詰むとレビュアー差し替え導線が
--    消える。→ 新規 rpc_review_cancel を追加し、依頼者/space admin/org owner が
--    レビューを 'cancelled' にできるようにする（reviews.status に 'cancelled'
--    を追加）。UI 側は別コミットで「レビューを取り消す」ボタンを追加する。
--
-- 3. [P2] レビューとタスク完了が分離
--    既存の trg_enforce_review_gate（20260703_000_collab_notifications.sql）は
--    reviews.status <> 'approved' のとき status→'done' を拒否する DBガードを
--    既に持っている。ただし今回 'cancelled' を追加すると、このガードは
--    cancelled も「approved でない」として永久ブロックしてしまう
--    （キャンセル済みレビューは「レビュー未作成」と同等に扱うべき）ため、
--    'approved' と 'cancelled' の両方を許容するよう更新する。
--    加えて type='spec' かつ decision_state='considering'（未決）のまま
--    done にできる抜け穴も同じトリガーで塞ぐ。
--
-- 4. [P3] rpc_review_approve が冪等でない
--    承認済みでも再実行すると task_events に REVIEW_APPROVE が毎回追記され
--    履歴が水増しされる。→ 自分の approval が既に 'approved' な再実行は
--    task_events 追記をスキップする。rpc_review_block も対称性のため、
--    実質的な状態変化（state or blocked_reason の変化）が無い再実行は
--    ball 差し戻し・通知・task_events 追記をスキップする。
--
-- Scope: 対象関数の再定義（create or replace）・reviews の CHECK 制約更新・
--        enforce_review_gate トリガー関数の更新・rpc_review_cancel の新規追加
--        のみ。既存の認可ロジック（20260703_009 の app_can_access_space ガード
--        等）はすべて維持する。
-- =============================================================================


-- =============================================================================
-- 0. reviews.status に 'cancelled' を追加
-- =============================================================================
ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_status_check;
ALTER TABLE reviews ADD CONSTRAINT reviews_status_check
  CHECK (status IN ('open', 'approved', 'changes_requested', 'cancelled'));


-- =============================================================================
-- 1. rpc_review_approve — reviews 行ロック + 冪等化
--    土台: 20260703_009_rpc_authz_hardening.sql（既存の認可ガードは維持）
-- =============================================================================
CREATE OR REPLACE FUNCTION rpc_review_approve(
  p_task_id uuid,
  p_meeting_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task tasks%ROWTYPE;
  v_actor_id uuid;
  v_review_id uuid;
  v_review_space_id uuid;
  v_review_org_id uuid;
  v_all_approved boolean;
  v_updated_rows int;
BEGIN
  v_actor_id := auth.uid();
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
  -- アクセス可能か検証する。既存の reviewer_id チェックより前段の多層防御。
  IF NOT public.app_can_access_space(v_review_space_id, v_review_org_id) THEN
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

  RETURN jsonb_build_object('ok', true, 'allApproved', v_all_approved);
END;
$$;


-- =============================================================================
-- 2. rpc_review_block — reviews 行ロック + 冪等化
--    土台: 20260703_009_rpc_authz_hardening.sql（既存の認可ガードは維持）
-- =============================================================================
CREATE OR REPLACE FUNCTION rpc_review_block(
  p_task_id uuid,
  p_blocked_reason text,
  p_meeting_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task tasks%ROWTYPE;
  v_actor_id uuid;
  v_review_id uuid;
  v_review_space_id uuid;
  v_review_org_id uuid;
  v_requester_id uuid;
  v_actor_name text;
  v_updated_rows int;
BEGIN
  v_actor_id := auth.uid();
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
  -- アクセス可能か検証する。既存の reviewer_id チェックより前段の多層防御。
  IF NOT public.app_can_access_space(v_review_space_id, v_review_org_id) THEN
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

  -- Notify the developer who requested the review (exclude self-block).
  SELECT display_name INTO v_actor_name FROM profiles WHERE id = v_actor_id;

  IF v_requester_id IS NOT NULL AND v_requester_id <> v_actor_id THEN
    PERFORM _create_task_notification(
      v_task.org_id,
      v_task.space_id,
      v_requester_id,
      'ball_passed',
      format('review_block:%s:%s', v_review_id, v_requester_id),
      jsonb_build_object(
        'task_id', p_task_id,
        'task_title', v_task.title,
        'title', format('差し戻し: 「%s」', v_task.title),
        'message', format('修正依頼: %s', p_blocked_reason),
        'from_user_name', v_actor_name,
        'ball', 'internal'
      )
    );
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;


-- =============================================================================
-- 3. rpc_review_cancel — レビューを取り消す（新規）
--    レビュアー離脱等で open/changes_requested のまま詰んだレビューを、
--    依頼者・space admin・org owner が取り消せるようにする。
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

  -- Note: 通知は追加しない。既存の review 系通知はすべて ACTIONABLE_TYPES
  -- （src/lib/notifications/classify.ts）に属し「対応が必要」という体裁で
  -- 描画される。キャンセルは対応不要のイベントであり、既存タイプを流用すると
  -- 誤ったアクションボタンが出るため、通知UIの新規タイプ追加は別途スコープとする。

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION rpc_review_cancel(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION rpc_review_cancel(uuid) TO authenticated;


-- =============================================================================
-- 4. enforce_review_gate — 'cancelled' を許容 + spec decision_state 未決ガード
--    土台: 20260703_000_collab_notifications.sql（既存の review 承認ゲートは
--    そのまま拡張する。新規に別トリガーを追加すると同一イベントに2つの
--    BEFORE UPDATE トリガーが競合するため、既存関数を再定義する）。
-- =============================================================================
CREATE OR REPLACE FUNCTION enforce_review_gate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'done' AND OLD.status IS DISTINCT FROM 'done' THEN
    -- 'cancelled' はレビュー未作成と同等（詰んだレビューを取り消した後の
    -- 再依頼導線を塞がないため、approved と同様に完了を妨げない）。
    IF EXISTS (
      SELECT 1 FROM reviews
      WHERE task_id = NEW.id AND status NOT IN ('approved', 'cancelled')
    ) THEN
      RAISE EXCEPTION 'Cannot complete task: review is not approved'
        USING errcode = 'check_violation';
    END IF;

    -- spec タスクは decision_state が未決（'considering'）のまま完了できない。
    IF NEW.type = 'spec' AND NEW.decision_state = 'considering' THEN
      RAISE EXCEPTION 'Cannot complete task: spec decision is not made'
        USING errcode = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- トリガー自体（trg_enforce_review_gate）は既存のまま
-- （BEFORE UPDATE OF status ON tasks）。関数の再定義のみで反映される。


-- =============================================================================
-- Grants（冪等な明示的宣言）
-- =============================================================================
REVOKE EXECUTE ON FUNCTION rpc_review_approve(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION rpc_review_block(uuid, text, uuid) FROM anon;

GRANT EXECUTE ON FUNCTION rpc_review_approve(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION rpc_review_block(uuid, text, uuid) TO authenticated;


-- =============================================================================
-- 検証（適用後の想定手動確認）:
--
--   A) 同時最終承認（Bug 1）:
--      レビュアー2名が pending の review で、それぞれ別セッションから
--      ほぼ同時に rpc_review_approve を実行する（psql 2セッションで
--      BEGIN; ...; の間に手動で相手を先に進める等）。
--      → 両方コミット後、reviews.status='approved' になっていること
--        （どちらか一方がロック待ちで直列化され、後続が正しい
--          v_all_approved=true を観測する）。
--
--   B) レビュー取り消し（Bug 2）:
--      status='open' の review に対し、(a) created_by 本人 (b) 対象spaceの
--      admin (c) 無関係の editor で rpc_review_cancel を実行。
--      → (a)(b) は成功し reviews.status='cancelled' になること。
--        (c) は 'Insufficient permissions...' で失敗すること。
--      取り消し後、同じ task に対して rpc_review_open を再実行すると
--      正常に新しい review サイクルが始まること（ON CONFLICT (task_id) の
--      upsert で同じ review 行が再利用される）。
--
--   C) 完了ガードの拡張（Bug 3）:
--      status='cancelled' の review を持つ task を status='done' に更新
--      → 成功すること（cancelled は approved と同様ブロックしない）。
--      status='open' または 'changes_requested' の review を持つ task を
--      status='done' に更新 → 'Cannot complete task: review is not approved'
--      で失敗すること（既存動作の回帰確認）。
--      type='spec' かつ decision_state='considering' の task を status='done'
--      に更新 → 'Cannot complete task: spec decision is not made' で
--      失敗すること。
--
--   D) 冪等化（Bug 4）:
--      既に approved 済みの reviewer で rpc_review_approve を再実行
--      → task_events の REVIEW_APPROVE 件数が増えないこと（
--        select count(*) from task_events where task_id=... and
--        action='REVIEW_APPROVE'; が再実行前後で不変）。
--      同一理由で rpc_review_block を連続実行 → 同様に task_events が
--      増えず、tasks.ball の UPDATE も再発行されないこと。
-- =============================================================================
