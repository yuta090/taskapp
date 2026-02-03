-- FR-OWN-002: 責任者欄の表示/非表示設定
-- スペース単位で責任者欄の表示/非表示を切り替え可能にする

-- =============================================================================
-- 1) organizations テーブルに owner_field_default カラムを追加
-- =============================================================================

ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS owner_field_default boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN organizations.owner_field_default IS '責任者欄のデフォルト表示設定（true=表示, false=非表示）';

-- =============================================================================
-- 2) spaces テーブルに owner_field_enabled カラムを追加
-- =============================================================================

ALTER TABLE spaces
ADD COLUMN IF NOT EXISTS owner_field_enabled boolean DEFAULT NULL;

COMMENT ON COLUMN spaces.owner_field_enabled IS '責任者欄の表示設定（true=表示, false=非表示, NULL=組織設定に従う）';

-- =============================================================================
-- 3) RPC: 責任者欄の表示判定
-- =============================================================================

CREATE OR REPLACE FUNCTION rpc_should_show_owner_field(p_space_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_space_enabled boolean;
  v_org_default boolean;
  v_org_id uuid;
BEGIN
  -- スペースの設定を取得
  SELECT owner_field_enabled, org_id
  INTO v_space_enabled, v_org_id
  FROM spaces
  WHERE id = p_space_id;

  -- スペースに明示的な設定があればそれを返す
  IF v_space_enabled IS NOT NULL THEN
    RETURN v_space_enabled;
  END IF;

  -- 組織のデフォルト設定を返す
  SELECT owner_field_default
  INTO v_org_default
  FROM organizations
  WHERE id = v_org_id;

  RETURN COALESCE(v_org_default, false);
END;
$$;

-- 権限設定
REVOKE EXECUTE ON FUNCTION rpc_should_show_owner_field(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rpc_should_show_owner_field(uuid) TO authenticated;
