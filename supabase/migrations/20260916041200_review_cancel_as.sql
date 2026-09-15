-- CLI / API からも「承認依頼を取り消す」ができるようにする
--
-- 画面のタスク詳細には「レビューを取り消す」があるのに、CLI・AI秘書には相当する道具が
-- 無かった。承認者が席を外した・依頼先を間違えたといった行き止まりを、CLI 側から畳めない。
-- rpc_review_cancel が `auth.uid()` を見ているため、鍵で動く道具（service_role・
-- ログイン中の利用者を持たない）からは呼べないのが理由。
--
-- このリポジトリの決まりどおり、本体を `_impl`（実行者を引数で受け取る）に出し、
-- 画面用（`auth.uid()` を渡す）と道具用（`_as`・実行者を明示）の2つで包む。
-- 20260912134823_mcp_rpc_as.sql が rpc_review_approve / rpc_review_block で使っている形と同じ。
--
-- 本体の中身は 20260911143112_space_role_boundary.sql の定義をそのまま写している。
-- 変えたのは2か所だけ:
--   1. 実行者の取り方（`auth.uid()` → `p_actor`）
--   2. 書ける役割の確かめを `_actor_can_write_space(v_actor_id, …)` にする
--      （`app_can_write_space` は中で `auth.uid()` を見るので、_as 経由では必ず落ちる）
-- 認可の条件（依頼者本人・space の管理者・org のオーナー）・取り消せる状態・
-- task_events・通知の作り方は一切変えていない。

-- =============================================================================
-- 節 0: 置き換える物の土台の確認（何も変えない）
--
-- 本体は今の rpc_review_cancel の写しなので、当てる先の現物が写し元と同じでなければ
-- 止める。本番だけ手当てが入っていた実例があり、`CREATE OR REPLACE` はそれを黙って
-- 上書きしてしまう。20260912134823_mcp_rpc_as.sql の節 0 と同じやり方。
-- 2回流しても止まらないよう、適用後の姿（包みになった形）も通す。
-- =============================================================================
do $$
declare
  v_md5 text;
begin
  set local lock_timeout = '3s';

  select md5(p.prosrc) into v_md5
    from pg_proc p
   where p.oid = to_regprocedure('public.rpc_review_cancel(uuid)')
     and p.prosecdef
     and p.proconfig = array['search_path=public'];

  if v_md5 is null or v_md5 not in (
    '93251f39196268918a8c80da2395003a',  -- 土台（20260911143112_space_role_boundary.sql の本文）
    'f608e317e054bc6cab477256250f223e'   -- 本 migration 適用後（_review_cancel_impl を呼ぶ包み）
  ) then
    raise exception '中止: rpc_review_cancel の今の定義が写し元と違います（md5=%）。本体を写し直してから当ててください',
      coalesce(v_md5, 'なし');
  end if;
end $$;

CREATE OR REPLACE FUNCTION public._review_cancel_impl(
  p_actor uuid,
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
  v_actor_id := p_actor;
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_review FROM reviews WHERE id = p_review_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Review not found: %', p_review_id;
  END IF;

  -- 認可ガード（監査B2 / 越境IDOR対策）: 呼出元が対象 review の space/org に
  -- 書き込める役割（社内の admin / editor）か検証する（他RPCと同じ多層防御の前段）。
  -- 判定の中身は app_can_write_space と同じ（20260912134823 の節1）。
  IF NOT public._actor_can_write_space(v_actor_id, v_review.space_id, v_review.org_id) THEN
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

-- 本体は誰にも直接は呼ばせない（下の2つの包みだけが呼ぶ）
REVOKE ALL ON FUNCTION public._review_cancel_impl(uuid, uuid) FROM public, anon, authenticated, service_role;

-- 画面用。ログイン中の利用者が実行者になる
CREATE OR REPLACE FUNCTION public.rpc_review_cancel(
  p_review_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public._review_cancel_impl(auth.uid(), p_review_id);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_review_cancel(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_review_cancel(uuid) TO authenticated, service_role;

-- 道具用（CLI / API / AI秘書）。誰が取り消したかを呼び出し側が明示する。
-- 鍵に紐づく利用者を渡すので、監査（task_events.actor_id）と通知の宛先が画面と同じ意味になる。
CREATE OR REPLACE FUNCTION public.rpc_review_cancel_as(
  p_actor uuid,
  p_review_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public._review_cancel_impl(p_actor, p_review_id);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_review_cancel_as(uuid, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_review_cancel_as(uuid, uuid) TO service_role;

-- =============================================================================
-- 節 9: 実行権が意図どおりか、その場で確かめる
-- 次に触る人が grant のズレに気づけるよう、当てた直後に自分で検算する。
-- =============================================================================
do $$
declare
  v_bad text := '';
begin
  if has_function_privilege('anon', 'public._review_cancel_impl(uuid,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public._review_cancel_impl(uuid,uuid)', 'execute')
     or has_function_privilege('service_role', 'public._review_cancel_impl(uuid,uuid)', 'execute') then
    v_bad := v_bad || ' 本体(_review_cancel_impl)に実行権が残っている;';
  end if;

  if has_function_privilege('anon', 'public.rpc_review_cancel_as(uuid,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.rpc_review_cancel_as(uuid,uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.rpc_review_cancel_as(uuid,uuid)', 'execute') then
    v_bad := v_bad || ' 道具用(rpc_review_cancel_as)は service_role だけのはず;';
  end if;

  if has_function_privilege('anon', 'public.rpc_review_cancel(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.rpc_review_cancel(uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.rpc_review_cancel(uuid)', 'execute') then
    v_bad := v_bad || ' 画面用(rpc_review_cancel)は authenticated と service_role のはず;';
  end if;

  if v_bad <> '' then
    raise exception '中止: 実行権が意図と違います:%', v_bad;
  end if;
end $$;

-- 適用後の確認:
--   1. 画面の「レビューを取り消す」がこれまでどおり動く（依頼者・space 管理者・org オーナー）。
--   2. `agentpm review cancel` で取り消すと、task_events.actor_id が鍵の持ち主になる。
--   3. authenticated が rpc_review_cancel_as を呼ぶと権限エラーになる。
--   4. 相手先の役割では、どちらの入口からも拒否される（app_can_write_space の既存の歯止め）。
