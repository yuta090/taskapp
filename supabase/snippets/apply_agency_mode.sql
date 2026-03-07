-- =====================================================================
-- Agency Mode 全マイグレーション (4ファイル統合)
-- Supabase Dashboard > SQL Editor で実行
-- =====================================================================

-- =====================================================================
-- 1/4: Foundation - スペース設定 + ロール拡張 + ボール拡張
-- =====================================================================
ALTER TABLE spaces ADD COLUMN IF NOT EXISTS agency_mode boolean NOT NULL DEFAULT false;
ALTER TABLE spaces ADD COLUMN IF NOT EXISTS default_margin_rate numeric(5,2) DEFAULT NULL;
ALTER TABLE spaces ADD COLUMN IF NOT EXISTS vendor_settings jsonb
  NOT NULL DEFAULT '{"show_client_name": false, "allow_client_comments": false}';

-- Constraints (DROP IF EXISTS for idempotency)
ALTER TABLE spaces DROP CONSTRAINT IF EXISTS chk_default_margin_rate;
ALTER TABLE spaces ADD CONSTRAINT chk_default_margin_rate
  CHECK (default_margin_rate IS NULL OR (default_margin_rate >= 0 AND default_margin_rate <= 999.99));

ALTER TABLE spaces DROP CONSTRAINT IF EXISTS chk_vendor_settings;
ALTER TABLE spaces ADD CONSTRAINT chk_vendor_settings CHECK (
  vendor_settings IS NOT NULL
  AND jsonb_typeof(vendor_settings->'show_client_name') = 'boolean'
  AND jsonb_typeof(vendor_settings->'allow_client_comments') = 'boolean'
);

-- BallSide extension
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_ball_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_ball_check
  CHECK (ball IN ('client', 'internal', 'agency', 'vendor'));

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_origin_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_origin_check
  CHECK (origin IN ('client', 'internal', 'agency', 'vendor'));

ALTER TABLE task_owners DROP CONSTRAINT IF EXISTS task_owners_side_check;
ALTER TABLE task_owners ADD CONSTRAINT task_owners_side_check
  CHECK (side IN ('client', 'internal', 'agency', 'vendor'));

-- SpaceRole extension
ALTER TABLE space_memberships DROP CONSTRAINT IF EXISTS space_memberships_role_check;
ALTER TABLE space_memberships ADD CONSTRAINT space_memberships_role_check
  CHECK (role IN ('admin', 'editor', 'viewer', 'client', 'vendor'));

-- InviteRole extension
ALTER TABLE invites DROP CONSTRAINT IF EXISTS invites_role_check;
ALTER TABLE invites ADD CONSTRAINT invites_role_check
  CHECK (role IN ('client', 'member', 'vendor'));

-- CommentVisibility extension
ALTER TABLE task_comments DROP CONSTRAINT IF EXISTS task_comments_visibility_check;
ALTER TABLE task_comments ADD CONSTRAINT task_comments_visibility_check
  CHECK (visibility IN ('client', 'internal', 'vendor', 'agency_only'));

-- =====================================================================
-- 2/4: Task Pricing テーブル
-- =====================================================================
CREATE TABLE IF NOT EXISTS task_pricing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  space_id uuid NOT NULL REFERENCES spaces(id),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  cost_hours numeric(8,2) DEFAULT NULL,
  cost_unit_price numeric(12,2) DEFAULT NULL,
  cost_total numeric(14,2) GENERATED ALWAYS AS (cost_hours * cost_unit_price) STORED,
  sell_mode text NOT NULL DEFAULT 'margin' CHECK (sell_mode IN ('margin', 'fixed')),
  margin_rate numeric(5,2) DEFAULT NULL CHECK (margin_rate IS NULL OR (margin_rate >= 0 AND margin_rate <= 999.99)),
  sell_total numeric(14,2) DEFAULT NULL,
  vendor_submitted_at timestamptz DEFAULT NULL,
  agency_approved_at timestamptz DEFAULT NULL,
  client_approved_at timestamptz DEFAULT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(task_id)
);

CREATE INDEX IF NOT EXISTS idx_task_pricing_space ON task_pricing(space_id);
CREATE INDEX IF NOT EXISTS idx_task_pricing_org ON task_pricing(org_id);

CREATE OR REPLACE FUNCTION update_task_pricing_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_task_pricing_updated_at ON task_pricing;
CREATE TRIGGER trg_task_pricing_updated_at
  BEFORE UPDATE ON task_pricing FOR EACH ROW
  EXECUTE FUNCTION update_task_pricing_updated_at();

-- =====================================================================
-- 3/4: Agency Settings Write Guard
-- =====================================================================
CREATE OR REPLACE FUNCTION guard_agency_settings()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE caller_role text;
BEGIN
  IF old.agency_mode IS NOT DISTINCT FROM new.agency_mode
     AND old.default_margin_rate IS NOT DISTINCT FROM new.default_margin_rate
     AND old.vendor_settings IS NOT DISTINCT FROM new.vendor_settings
  THEN RETURN new; END IF;
  IF current_setting('role', true) = 'service_role' THEN RETURN new; END IF;
  SELECT sm.role INTO caller_role FROM space_memberships sm
   WHERE sm.space_id = new.id AND sm.user_id = auth.uid() LIMIT 1;
  IF caller_role IN ('admin', 'editor') THEN RETURN new; END IF;
  RAISE EXCEPTION 'permission denied: only admin/editor can update agency settings';
END; $$;

DROP TRIGGER IF EXISTS trg_guard_agency_settings ON spaces;
CREATE TRIGGER trg_guard_agency_settings
  BEFORE UPDATE ON spaces FOR EACH ROW
  EXECUTE FUNCTION guard_agency_settings();

-- =====================================================================
-- 4/4: Task Pricing Write Guard
-- =====================================================================
CREATE OR REPLACE FUNCTION guard_task_pricing_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_space_id uuid; caller_role text;
BEGIN
  IF current_setting('role', true) = 'service_role' THEN RETURN new; END IF;
  SELECT t.space_id INTO v_space_id FROM tasks t WHERE t.id = new.task_id;
  IF v_space_id IS NULL THEN RAISE EXCEPTION 'task not found'; END IF;
  SELECT sm.role INTO caller_role FROM space_memberships sm
   WHERE sm.space_id = v_space_id AND sm.user_id = auth.uid() LIMIT 1;
  IF caller_role IN ('admin', 'editor', 'vendor') THEN RETURN new; END IF;
  RAISE EXCEPTION 'permission denied: only admin/editor/vendor can modify task pricing';
END; $$;

DROP TRIGGER IF EXISTS trg_guard_task_pricing_write ON task_pricing;
CREATE TRIGGER trg_guard_task_pricing_write
  BEFORE INSERT OR UPDATE ON task_pricing FOR EACH ROW
  EXECUTE FUNCTION guard_task_pricing_write();

CREATE OR REPLACE FUNCTION guard_task_pricing_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_space_id uuid; caller_role text;
BEGIN
  IF current_setting('role', true) = 'service_role' THEN RETURN old; END IF;
  SELECT t.space_id INTO v_space_id FROM tasks t WHERE t.id = old.task_id;
  SELECT sm.role INTO caller_role FROM space_memberships sm
   WHERE sm.space_id = v_space_id AND sm.user_id = auth.uid() LIMIT 1;
  IF caller_role IN ('admin', 'editor') THEN RETURN old; END IF;
  RAISE EXCEPTION 'permission denied: only admin/editor can delete task pricing';
END; $$;

DROP TRIGGER IF EXISTS trg_guard_task_pricing_delete ON task_pricing;
CREATE TRIGGER trg_guard_task_pricing_delete
  BEFORE DELETE ON task_pricing FOR EACH ROW
  EXECUTE FUNCTION guard_task_pricing_delete();

-- =====================================================================
-- Done! Verify:
-- =====================================================================
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'spaces' AND column_name IN ('agency_mode', 'default_margin_rate', 'vendor_settings');

SELECT table_name FROM information_schema.tables WHERE table_name = 'task_pricing';
