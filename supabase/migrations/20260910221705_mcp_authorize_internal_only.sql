-- API キーの権限の是正。
-- 1) api_keys: 書き込みはサーバーの窓口（service role）だけに限る。読み取りのポリシーは SELECT 専用に作り直す
--    （authenticated の SELECT は api_key_usage の RLS が参照するため残す）。
-- 2) mcp_authorize: 鍵の持ち主と組織の整合を確かめる。相手先（client / vendor）の役割では API キーを使えない
--    （社内メンバー専用）。ほかの判定・引数・戻り値の形は変えない（本番の pg_get_functiondef を元にしている）。
-- 3) 持ち主（user_id）の無い古い space 鍵を無効化する（削除は利用記録まで消えるのでしない）。冪等。

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.api_keys FROM anon, authenticated;
REVOKE SELECT ON public.api_keys FROM anon;

DROP POLICY IF EXISTS api_keys_admin_policy ON public.api_keys;
DROP POLICY IF EXISTS api_keys_select_policy ON public.api_keys;
CREATE POLICY api_keys_select_policy ON public.api_keys
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM org_memberships om
      WHERE om.org_id = api_keys.org_id
        AND om.user_id = auth.uid()
        AND om.role = 'owner'
    )
    OR
    EXISTS (
      SELECT 1 FROM space_memberships sm
      WHERE sm.space_id = api_keys.space_id
        AND sm.user_id = auth.uid()
        AND sm.role = 'admin'
    )
  );

CREATE OR REPLACE FUNCTION public.mcp_authorize(p_key_id uuid, p_user_id uuid, p_space_id uuid, p_action text, p_resource_type text DEFAULT NULL::text, p_resource_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_key_record RECORD;
  v_member_record RECORD;
  v_result jsonb;
  v_allowed boolean := false;
  v_role text;
  v_reason text;
BEGIN
  -- 1) APIキーの検証
  SELECT * INTO v_key_record
  FROM api_keys
  WHERE id = p_key_id
    AND is_active = true
    AND (expires_at IS NULL OR expires_at > now());

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'Invalid or expired API key'
    );
  END IF;

  -- 1b) 鍵の持ち主の確認: 鍵は発行した本人の代わりにだけ動き、持ち主はその組織のメンバーであること
  IF v_key_record.user_id IS NULL OR v_key_record.user_id IS DISTINCT FROM v_key_record.created_by THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'API key owner mismatch'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM org_memberships om
    WHERE om.org_id = v_key_record.org_id
      AND om.user_id = v_key_record.user_id
  ) THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'Key owner is not a member of the organization'
    );
  END IF;

  -- 2) アクションの許可チェック
  IF NOT (p_action = ANY(v_key_record.allowed_actions)) THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', format('Action "%s" not allowed for this API key', p_action)
    );
  END IF;

  -- 3) スコープに基づくスペースアクセスチェック
  CASE v_key_record.scope
    WHEN 'space' THEN
      -- space_id が一致する必要がある
      IF v_key_record.space_id IS DISTINCT FROM p_space_id THEN
        RETURN jsonb_build_object(
          'allowed', false,
          'reason', 'Space ID does not match API key scope'
        );
      END IF;

      -- そのプロジェクトが鍵の組織のものである必要がある
      IF NOT EXISTS (
        SELECT 1 FROM spaces s
        WHERE s.id = p_space_id AND s.org_id = v_key_record.org_id
      ) THEN
        RETURN jsonb_build_object(
          'allowed', false,
          'reason', 'Space does not belong to the organization'
        );
      END IF;

    WHEN 'org' THEN
      -- スペースが同じ組織に属している必要がある
      IF NOT EXISTS (
        SELECT 1 FROM spaces s
        WHERE s.id = p_space_id AND s.org_id = v_key_record.org_id
      ) THEN
        RETURN jsonb_build_object(
          'allowed', false,
          'reason', 'Space does not belong to the organization'
        );
      END IF;

    WHEN 'user' THEN
      -- ユーザーがスペースのメンバーである必要がある
      IF v_key_record.user_id IS NULL THEN
        RETURN jsonb_build_object(
          'allowed', false,
          'reason', 'User-scoped key requires user_id'
        );
      END IF;

      -- allowed_space_ids が設定されている場合はチェック
      IF v_key_record.allowed_space_ids IS NOT NULL
         AND NOT (p_space_id = ANY(v_key_record.allowed_space_ids)) THEN
        RETURN jsonb_build_object(
          'allowed', false,
          'reason', 'Space not in allowed_space_ids'
        );
      END IF;
  END CASE;

  -- 4) ユーザーのスペースメンバーシップと権限チェック
  SELECT sm.role INTO v_role
  FROM space_memberships sm
  WHERE sm.space_id = p_space_id
    AND sm.user_id = COALESCE(v_key_record.user_id, p_user_id);

  IF v_role IS NULL THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'User is not a member of this space'
    );
  END IF;

  -- 5) ロールに基づくアクション許可チェック
  CASE v_role
    WHEN 'viewer' THEN
      -- viewer は read のみ
      v_allowed := (p_action = 'read');
      IF NOT v_allowed THEN
        v_reason := 'Viewer role can only read';
      END IF;

    WHEN 'client', 'vendor' THEN
      -- 相手先（client / vendor）の役割では API キーを使えない（API キーは社内メンバー専用）
      v_allowed := false;
      v_reason := 'API keys are available to internal members only';
    WHEN 'editor' THEN
      -- editor は read, write, delete（自分のリソースのみ）
      IF p_action IN ('read', 'write') THEN
        v_allowed := true;
      ELSIF p_action = 'delete' THEN
        -- 自分が作成したリソースのみ削除可能
        IF p_resource_type = 'task' AND p_resource_id IS NOT NULL THEN
          v_allowed := EXISTS (
            SELECT 1 FROM tasks t
            WHERE t.id = p_resource_id
              AND t.created_by = COALESCE(v_key_record.user_id, p_user_id)
          );
          IF NOT v_allowed THEN
            v_reason := 'Editor can only delete own tasks';
          END IF;
        ELSE
          v_allowed := false;
          v_reason := 'Delete requires resource ownership';
        END IF;
      ELSE
        v_allowed := false;
        v_reason := 'Editor cannot perform bulk operations';
      END IF;

    WHEN 'admin' THEN
      -- admin は全ての操作が可能
      v_allowed := true;

    ELSE
      v_allowed := false;
      v_reason := 'Unknown role';
  END CASE;

  -- 結果を返す
  RETURN jsonb_build_object(
    'allowed', v_allowed,
    'role', v_role,
    'scope', v_key_record.scope,
    'reason', COALESCE(v_reason, 'OK')
  );
END;
$function$;

UPDATE public.api_keys
SET is_active = false
WHERE scope = 'space' AND user_id IS NULL AND is_active = true;
