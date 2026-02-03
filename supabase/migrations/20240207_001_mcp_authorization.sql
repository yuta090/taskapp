-- MCP Authorization System
-- ユーザー横断アクセス + プロジェクト単位権限チェック

-- =============================================================================
-- 1) api_keys テーブル拡張
-- =============================================================================

-- スコープ追加: 'space' (従来), 'org' (組織内全て), 'user' (ユーザーの全プロジェクト)
ALTER TABLE api_keys
ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'space'
  CHECK (scope IN ('space', 'org', 'user'));

-- space_id を NULL 許可に変更（scope='user' の場合）
ALTER TABLE api_keys
ALTER COLUMN space_id DROP NOT NULL;

-- 許可されたスペースID（scope='user'でも制限可能）
ALTER TABLE api_keys
ADD COLUMN IF NOT EXISTS allowed_space_ids uuid[] DEFAULT NULL;

-- 許可されたアクション
ALTER TABLE api_keys
ADD COLUMN IF NOT EXISTS allowed_actions text[] NOT NULL DEFAULT ARRAY['read']
  CHECK (allowed_actions <@ ARRAY['read', 'write', 'delete', 'bulk']);

-- APIキーに紐づくユーザーID（scope='user'の場合に使用）
ALTER TABLE api_keys
ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);

-- コメント
COMMENT ON COLUMN api_keys.scope IS 'space=特定スペースのみ, org=組織内全て, user=ユーザーの全プロジェクト';
COMMENT ON COLUMN api_keys.allowed_space_ids IS 'scope=userでも特定スペースに制限可能（NULLは全て許可）';
COMMENT ON COLUMN api_keys.allowed_actions IS '許可されるアクション: read, write, delete, bulk';

-- =============================================================================
-- 2) api_key_usage 監査テーブル
-- =============================================================================

CREATE TABLE IF NOT EXISTS api_key_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_id uuid NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id),
  space_id uuid REFERENCES spaces(id),
  action text NOT NULL,
  tool_name text NOT NULL,
  resource_type text,
  resource_id uuid,
  success boolean NOT NULL DEFAULT true,
  error_message text,
  request_metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- インデックス
CREATE INDEX IF NOT EXISTS api_key_usage_key_idx ON api_key_usage(key_id);
CREATE INDEX IF NOT EXISTS api_key_usage_space_idx ON api_key_usage(space_id);
CREATE INDEX IF NOT EXISTS api_key_usage_created_idx ON api_key_usage(created_at DESC);

-- RLS
ALTER TABLE api_key_usage ENABLE ROW LEVEL SECURITY;

-- 監査ログは組織オーナーのみ閲覧可能
CREATE POLICY api_key_usage_read_policy ON api_key_usage
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM api_keys ak
      JOIN org_memberships om ON om.org_id = ak.org_id
      WHERE ak.id = api_key_usage.key_id
        AND om.user_id = auth.uid()
        AND om.role = 'owner'
    )
  );

COMMENT ON TABLE api_key_usage IS 'MCP API使用監査ログ';

-- =============================================================================
-- 3) authorize 関数 - 権限チェックの中核
-- =============================================================================

CREATE OR REPLACE FUNCTION mcp_authorize(
  p_key_id uuid,
  p_user_id uuid,
  p_space_id uuid,
  p_action text,
  p_resource_type text DEFAULT NULL,
  p_resource_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

    WHEN 'client' THEN
      -- client は read + 自分のリソースへの write
      IF p_action = 'read' THEN
        v_allowed := true;
      ELSIF p_action = 'write' AND p_resource_id IS NOT NULL THEN
        -- リソースオーナーシップチェック（タスクの場合）
        IF p_resource_type = 'task' THEN
          v_allowed := EXISTS (
            SELECT 1 FROM tasks t
            WHERE t.id = p_resource_id
              AND (t.created_by = COALESCE(v_key_record.user_id, p_user_id)
                   OR t.assignee_id = COALESCE(v_key_record.user_id, p_user_id))
          );
          IF NOT v_allowed THEN
            v_reason := 'Client can only modify own tasks';
          END IF;
        ELSE
          v_allowed := false;
          v_reason := 'Client write access limited to tasks';
        END IF;
      ELSE
        v_allowed := false;
        v_reason := 'Client role cannot perform this action';
      END IF;

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
$$;

COMMENT ON FUNCTION mcp_authorize IS 'MCP操作の権限チェック。全てのMCPツールはこの関数を呼び出して権限を確認する';

-- =============================================================================
-- 4) 監査ログ記録関数
-- =============================================================================

CREATE OR REPLACE FUNCTION mcp_log_usage(
  p_key_id uuid,
  p_user_id uuid,
  p_space_id uuid,
  p_action text,
  p_tool_name text,
  p_resource_type text DEFAULT NULL,
  p_resource_id uuid DEFAULT NULL,
  p_success boolean DEFAULT true,
  p_error_message text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_log_id uuid;
BEGIN
  INSERT INTO api_key_usage (
    key_id, user_id, space_id, action, tool_name,
    resource_type, resource_id, success, error_message, request_metadata
  )
  VALUES (
    p_key_id, p_user_id, p_space_id, p_action, p_tool_name,
    p_resource_type, p_resource_id, p_success, p_error_message, p_metadata
  )
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

-- =============================================================================
-- 5) rpc_validate_api_key 関数を拡張
-- =============================================================================

CREATE OR REPLACE FUNCTION rpc_validate_api_key(p_api_key text)
RETURNS TABLE (
  org_id uuid,
  space_id uuid,
  key_id uuid,
  user_id uuid,
  scope text,
  allowed_space_ids uuid[],
  allowed_actions text[]
) AS $$
DECLARE
  v_key_hash text;
BEGIN
  -- Hash the provided key
  v_key_hash := encode(digest(p_api_key, 'sha256'), 'hex');

  -- Find and return matching active key with extended info
  RETURN QUERY
  SELECT
    ak.org_id,
    ak.space_id,
    ak.id,
    ak.user_id,
    ak.scope,
    ak.allowed_space_ids,
    ak.allowed_actions
  FROM api_keys ak
  WHERE ak.key_hash = v_key_hash
    AND ak.is_active = true
    AND (ak.expires_at IS NULL OR ak.expires_at > now());

  -- Update last_used_at
  UPDATE api_keys
  SET last_used_at = now()
  WHERE key_hash = v_key_hash AND is_active = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- 6) dry_run 確認トークン管理
-- =============================================================================

CREATE TABLE IF NOT EXISTS mcp_confirm_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_id uuid NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_ids uuid[] NOT NULL,
  affected_count int NOT NULL,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mcp_confirm_tokens_hash_idx ON mcp_confirm_tokens(token_hash);
CREATE INDEX IF NOT EXISTS mcp_confirm_tokens_expires_idx ON mcp_confirm_tokens(expires_at);

-- 期限切れトークンを自動削除（1日以上古いもの）
CREATE OR REPLACE FUNCTION cleanup_expired_confirm_tokens()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM mcp_confirm_tokens
  WHERE expires_at < now() - interval '1 day';
END;
$$;

COMMENT ON TABLE mcp_confirm_tokens IS '破壊的操作の2段階確認用トークン';

-- =============================================================================
-- 7) dry_run 実行関数
-- =============================================================================

CREATE OR REPLACE FUNCTION mcp_dry_run_delete(
  p_key_id uuid,
  p_space_id uuid,
  p_resource_type text,
  p_resource_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_affected_count int;
  v_confirm_token text;
  v_token_hash text;
  v_token_id uuid;
BEGIN
  -- 対象件数をカウント
  IF p_resource_type = 'task' THEN
    SELECT COUNT(*) INTO v_affected_count
    FROM tasks t
    WHERE t.id = ANY(p_resource_ids)
      AND t.space_id = p_space_id;
  ELSE
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Unsupported resource type'
    );
  END IF;

  -- 確認トークンを生成
  v_confirm_token := encode(gen_random_bytes(32), 'hex');
  v_token_hash := encode(digest(v_confirm_token, 'sha256'), 'hex');

  -- トークンを保存
  INSERT INTO mcp_confirm_tokens (
    key_id, space_id, action, resource_type, resource_ids,
    affected_count, token_hash
  )
  VALUES (
    p_key_id, p_space_id, 'delete', p_resource_type, p_resource_ids,
    v_affected_count, v_token_hash
  )
  RETURNING id INTO v_token_id;

  RETURN jsonb_build_object(
    'success', true,
    'dry_run', true,
    'affected_count', v_affected_count,
    'resource_type', p_resource_type,
    'resource_ids', p_resource_ids,
    'confirm_token', v_confirm_token,
    'expires_in_seconds', 300,
    'message', format('This will delete %s %s(s). Use confirm_token to execute.', v_affected_count, p_resource_type)
  );
END;
$$;

-- =============================================================================
-- 8) confirm 実行関数
-- =============================================================================

CREATE OR REPLACE FUNCTION mcp_confirm_delete(
  p_key_id uuid,
  p_confirm_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token_hash text;
  v_token_record RECORD;
  v_deleted_count int := 0;
BEGIN
  v_token_hash := encode(digest(p_confirm_token, 'sha256'), 'hex');

  -- トークンを検証
  SELECT * INTO v_token_record
  FROM mcp_confirm_tokens
  WHERE token_hash = v_token_hash
    AND key_id = p_key_id
    AND used_at IS NULL
    AND expires_at > now();

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Invalid, expired, or already used confirm token'
    );
  END IF;

  -- 実際の削除を実行
  IF v_token_record.resource_type = 'task' THEN
    DELETE FROM tasks
    WHERE id = ANY(v_token_record.resource_ids)
      AND space_id = v_token_record.space_id;
    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  END IF;

  -- トークンを使用済みにマーク
  UPDATE mcp_confirm_tokens
  SET used_at = now()
  WHERE id = v_token_record.id;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_count', v_deleted_count,
    'resource_type', v_token_record.resource_type
  );
END;
$$;

-- 権限設定
REVOKE ALL ON FUNCTION mcp_authorize FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mcp_authorize TO authenticated, service_role;

REVOKE ALL ON FUNCTION mcp_log_usage FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mcp_log_usage TO authenticated, service_role;

REVOKE ALL ON FUNCTION mcp_dry_run_delete FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mcp_dry_run_delete TO authenticated, service_role;

REVOKE ALL ON FUNCTION mcp_confirm_delete FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mcp_confirm_delete TO authenticated, service_role;
