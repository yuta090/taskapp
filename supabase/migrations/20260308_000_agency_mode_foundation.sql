-- Agency Mode Foundation: スペース設定 + ロール拡張 + ボール拡張
-- Iron Rule: agency_mode=false のスペースでは既存動作に一切影響なし

-- 1. spaces テーブルに agency_mode フラグ + デフォルトマージン率を追加
ALTER TABLE spaces ADD COLUMN agency_mode boolean NOT NULL DEFAULT false;
ALTER TABLE spaces ADD COLUMN default_margin_rate numeric(5,2) DEFAULT NULL;

ALTER TABLE spaces ADD CONSTRAINT chk_default_margin_rate
  CHECK (default_margin_rate IS NULL OR (default_margin_rate >= 0 AND default_margin_rate <= 999.99));

COMMENT ON COLUMN spaces.agency_mode IS '代理店モード有効フラグ（true のスペースでのみ vendor/agency ボール・ベンダーポータルが有効）';
COMMENT ON COLUMN spaces.default_margin_rate IS 'デフォルトマージン率（%）。タスク個別に上書き可能';

-- 2. spaces テーブルにベンダー設定を追加
ALTER TABLE spaces ADD COLUMN vendor_settings jsonb
  NOT NULL DEFAULT '{"show_client_name": false, "allow_client_comments": false}';

ALTER TABLE spaces ADD CONSTRAINT chk_vendor_settings CHECK (
  vendor_settings IS NOT NULL
  AND jsonb_typeof(vendor_settings->'show_client_name') = 'boolean'
  AND jsonb_typeof(vendor_settings->'allow_client_comments') = 'boolean'
);

COMMENT ON COLUMN spaces.vendor_settings IS 'ベンダーポータル設定（agency_mode=true のスペースでのみ有効）';

-- 3. BallSide 拡張: 'agency' | 'vendor' を追加（既存の 'client' | 'internal' は維持）
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_ball_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_ball_check
  CHECK (ball IN ('client', 'internal', 'agency', 'vendor'));

-- origin も同様に拡張
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_origin_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_origin_check
  CHECK (origin IN ('client', 'internal', 'agency', 'vendor'));

-- 4. task_owners.side 拡張
ALTER TABLE task_owners DROP CONSTRAINT IF EXISTS task_owners_side_check;
ALTER TABLE task_owners ADD CONSTRAINT task_owners_side_check
  CHECK (side IN ('client', 'internal', 'agency', 'vendor'));

-- 5. SpaceRole 拡張: 'vendor' を追加
ALTER TABLE space_memberships DROP CONSTRAINT IF EXISTS space_memberships_role_check;
ALTER TABLE space_memberships ADD CONSTRAINT space_memberships_role_check
  CHECK (role IN ('admin', 'editor', 'viewer', 'client', 'vendor'));

-- 6. InviteRole 拡張: 'vendor' を追加
ALTER TABLE invites DROP CONSTRAINT IF EXISTS invites_role_check;
ALTER TABLE invites ADD CONSTRAINT invites_role_check
  CHECK (role IN ('client', 'member', 'vendor'));

-- 7. CommentVisibility 拡張: 'vendor' | 'agency_only' を追加
ALTER TABLE task_comments DROP CONSTRAINT IF EXISTS task_comments_visibility_check;
ALTER TABLE task_comments ADD CONSTRAINT task_comments_visibility_check
  CHECK (visibility IN ('client', 'internal', 'vendor', 'agency_only'));
