-- RPC: 組織メンバー一覧取得
-- org_memberships + profiles + auth.users を JOIN
-- SECURITY DEFINER で auth.users.email にアクセス
-- 既存の rpc_get_space_members と同じパターン

CREATE OR REPLACE FUNCTION rpc_get_org_members(p_org_id uuid)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  avatar_url text,
  email text,
  role text,
  joined_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
BEGIN
  -- 認証チェック
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- 呼び出し元がこの組織のメンバーであることを確認
  IF NOT EXISTS (
    SELECT 1 FROM org_memberships om_check
    WHERE om_check.org_id = p_org_id AND om_check.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied: not a member of this organization';
  END IF;

  RETURN QUERY
  SELECT
    om.user_id,
    COALESCE(p.display_name, 'User') as display_name,
    p.avatar_url,
    au.email::text,
    om.role,
    om.created_at as joined_at
  FROM org_memberships om
  LEFT JOIN profiles p ON p.id = om.user_id
  LEFT JOIN auth.users au ON au.id = om.user_id
  WHERE om.org_id = p_org_id
  ORDER BY
    CASE om.role
      WHEN 'owner' THEN 1
      WHEN 'member' THEN 2
      WHEN 'client' THEN 3
      ELSE 4
    END,
    om.created_at ASC;
END;
$$;

-- 権限を制限（認証ユーザーのみ実行可能）
REVOKE EXECUTE ON FUNCTION rpc_get_org_members(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rpc_get_org_members(uuid) TO authenticated;
