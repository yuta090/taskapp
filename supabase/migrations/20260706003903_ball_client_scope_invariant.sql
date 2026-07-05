-- =============================================================================
-- 不変条件の強制: ball='client' ⟹ client_scope='deliverable'
--
-- 背景: ball='client'（クライアント対応待ち）だが client_scope='internal'
--   （クライアント非公開）のタスクが通常UIで作成できてしまう不整合があった。
--   20260703_010_rls_vendor_task_scope.sql の app_task_visible_to_caller により
--   client_scope != 'deliverable' の行はクライアントから不可視になるため、
--   このパターンのタスクは「クライアントは承認依頼メールを受けてもリンク先が
--   404」「社内は『クライアント待ち』表示のまま誰も動けない」という行き止まり
--   になる。UI側（TaskCreateSheet / TaskInspector / useTasks）に加え、DB側でも
--   同じ不変条件を強制する（多層防御）。
--
-- 本番データ影響: 2026-07-05 時点で違反行は0件（確認済み）。データ移行は不要、
--   新規書込みのガードのみを追加する。
-- minutes-parser（20240206_000_minutes_parser.sql）への影響: client_scope を
--   明示せず INSERT するため、カラムの DEFAULT 'deliverable'（DDL v0.5）が
--   適用される。ball='client' で作成されるケースでも既定で不変条件を満たすため
--   無影響。
--
-- 変更内容:
--   1. rpc_pass_ball 再定義（土台: 20260703_009_rpc_authz_hardening.sql）:
--      p_ball='client' への遷移時、対象タスクの client_scope が 'deliverable'
--      でなければ同一 UPDATE 内で 'deliverable' に更新する。エラーにはしない
--      （ボールを渡す＝クライアントに見せる意思とみなす。アプリ側 useTasks の
--      passBall と同じ意味論）。
--   2. トリガー enforce_ball_client_scope（BEFORE INSERT OR UPDATE on tasks）:
--      NEW の ball='client' かつ client_scope が 'deliverable' でなければ
--      例外を送出する。rpc_pass_ball が先に scope を揃えるため矛盾しない。
--      アプリ経由（createTask/updateTask）の書込みも本トリガーで最終防衛される。
--
-- 冪等: create or replace function / drop trigger if exists → create。再実行安全。
-- 可逆: 末尾ロールバック節を参照。
-- =============================================================================

-- =============================================================================
-- 1. rpc_pass_ball 再定義（土台: 20260703_009_rpc_authz_hardening.sql）
--    p_ball='client' の場合、client_scope が 'deliverable' でなければ同時に揃える。
-- =============================================================================
CREATE OR REPLACE FUNCTION rpc_pass_ball(
  p_task_id uuid,
  p_ball text,
  p_client_owner_ids uuid[] DEFAULT '{}',
  p_internal_owner_ids uuid[] DEFAULT '{}',
  p_reason text DEFAULT NULL,
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
  v_org_id uuid;
  v_space_id uuid;
  v_actor_name text;
  v_recipient_ids uuid[];
  v_recipient uuid;
BEGIN
  -- Get current user
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Get task info
  SELECT * INTO v_task FROM tasks WHERE id = p_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found: %', p_task_id;
  END IF;

  -- 認可ガード（監査B2 / 越境IDOR対策）: 呼出元が対象 task の space/org に
  -- アクセス可能か検証する。ミューテーション前に実行し、越境操作を弾く。
  IF NOT public.app_can_access_space(v_task.space_id, v_task.org_id) THEN
    RAISE EXCEPTION 'Not authorized to access this task';
  END IF;

  v_org_id := v_task.org_id;
  v_space_id := v_task.space_id;

  -- Validate: ball='client' requires at least one client owner
  IF p_ball = 'client' AND array_length(p_client_owner_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Client owner required when ball=client';
  END IF;

  -- 不変条件: ball='client' へ渡す＝クライアントに見せる意思とみなし、
  -- client_scope が 'deliverable' でなければ同一UPDATEで揃える（エラーにしない）。
  UPDATE tasks
  SET
    ball = p_ball,
    client_scope = CASE
      WHEN p_ball = 'client' AND client_scope IS DISTINCT FROM 'deliverable'
        THEN 'deliverable'
      ELSE client_scope
    END,
    updated_at = now()
  WHERE id = p_task_id;

  -- Delete existing owners and insert new ones
  DELETE FROM task_owners WHERE task_id = p_task_id;

  -- Insert client owners
  IF array_length(p_client_owner_ids, 1) > 0 THEN
    INSERT INTO task_owners (org_id, space_id, task_id, side, user_id)
    SELECT v_org_id, v_space_id, p_task_id, 'client', unnest(p_client_owner_ids);
  END IF;

  -- Insert internal owners
  IF array_length(p_internal_owner_ids, 1) > 0 THEN
    INSERT INTO task_owners (org_id, space_id, task_id, side, user_id)
    SELECT v_org_id, v_space_id, p_task_id, 'internal', unnest(p_internal_owner_ids);
  END IF;

  -- Create audit log
  INSERT INTO task_events (org_id, space_id, task_id, actor_id, meeting_id, action, payload)
  VALUES (
    v_org_id,
    v_space_id,
    p_task_id,
    v_actor_id,
    p_meeting_id,
    'PASS_BALL',
    jsonb_build_object(
      'ball', p_ball,
      'clientOwnerIds', p_client_owner_ids,
      'internalOwnerIds', p_internal_owner_ids,
      'reason', p_reason
    )
  );

  -- Notify the owners on the receiving side (the side that must now act).
  -- This is what closes the "confirm / act next" loop for internal↔internal too.
  v_recipient_ids := CASE WHEN p_ball = 'client' THEN p_client_owner_ids ELSE p_internal_owner_ids END;
  SELECT display_name INTO v_actor_name FROM profiles WHERE id = v_actor_id;

  IF array_length(v_recipient_ids, 1) > 0 THEN
    FOREACH v_recipient IN ARRAY v_recipient_ids LOOP
      IF v_recipient <> v_actor_id THEN
        PERFORM _create_task_notification(
          v_org_id,
          v_space_id,
          v_recipient,
          'ball_passed',
          format('ball_passed:%s:%s', p_task_id, v_recipient),
          jsonb_build_object(
            'task_id', p_task_id,
            'task_title', v_task.title,
            'title', format('「%s」があなたの番です', v_task.title),
            'message', COALESCE(p_reason, 'ボールがあなたに渡されました。対応を開始してください。'),
            'from_user_name', v_actor_name,
            'ball', p_ball
          )
        );
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- 権限は 20260703_009_rpc_authz_hardening.sql の GRANT/REVOKE を維持（再定義しない）。

-- =============================================================================
-- 2. トリガー enforce_ball_client_scope
--    NEW.ball='client' かつ NEW.client_scope が 'deliverable' でなければ拒否。
--    rpc_pass_ball が先に scope を揃えるため、正規の経路とは矛盾しない。
-- =============================================================================
CREATE OR REPLACE FUNCTION public.enforce_ball_client_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.ball = 'client' AND NEW.client_scope IS DISTINCT FROM 'deliverable' THEN
    RAISE EXCEPTION 'ball=client requires client_scope=deliverable (task %)', NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_ball_client_scope() IS
  '不変条件: ball=client のタスクは client_scope=deliverable でなければならない（RLS上クライアントから不可視になり行き止まりになるため）';

DROP TRIGGER IF EXISTS trg_enforce_ball_client_scope ON public.tasks;
CREATE TRIGGER trg_enforce_ball_client_scope
  BEFORE INSERT OR UPDATE ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_ball_client_scope();

-- =============================================================================
-- 検証（本番適用前にローカル/ステージングで確認）:
--   1) INSERT ... (ball='client', client_scope='internal') → 例外で拒否。
--   2) INSERT ... (ball='client', client_scope='deliverable') → 成功。
--   3) UPDATE tasks SET client_scope='internal' WHERE ball='client' → 例外で拒否。
--   4) rpc_pass_ball(p_ball='client', ...) を client_scope='internal' の
--      タスクに対して実行 → 成功し、実行後 client_scope='deliverable' になる。
--   5) rpc_pass_ball(p_ball='internal', ...) → client_scope は変更されない。
--   6) minutes-parser 経由のタスク作成（client_scope 未指定） → DEFAULT
--      'deliverable' が適用されトリガーと矛盾しない。
--
-- ロールバック:
--   DROP TRIGGER IF EXISTS trg_enforce_ball_client_scope ON public.tasks;
--   DROP FUNCTION IF EXISTS public.enforce_ball_client_scope();
--   -- rpc_pass_ball は 20260703_009_rpc_authz_hardening.sql の定義に戻す
--   -- （当該ファイルを再実行して CREATE OR REPLACE で復元する）。
-- =============================================================================
