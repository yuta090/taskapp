-- DDL v0.8: Space archive & folder groups
-- Phase A: archived_at for soft-archiving spaces
-- Phase B: space_groups for organizing spaces into folders

-- ============================================================================
-- Phase A: Space Archive
-- ============================================================================

-- 1. Archive columns on spaces
ALTER TABLE spaces ADD COLUMN IF NOT EXISTS archived_at timestamptz NULL;
ALTER TABLE spaces ADD COLUMN IF NOT EXISTS archived_by uuid NULL REFERENCES auth.users(id);

COMMENT ON COLUMN spaces.archived_at IS 'Archive timestamp. NULL = active space.';
COMMENT ON COLUMN spaces.archived_by IS 'User who archived this space.';

-- Index for fast active-space queries
CREATE INDEX IF NOT EXISTS idx_spaces_active
  ON spaces (org_id)
  WHERE archived_at IS NULL;

-- ============================================================================
-- Phase B: Space Groups (Folders)
-- ============================================================================

-- 2. Space groups table
CREATE TABLE IF NOT EXISTS space_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, org_id)  -- 複合FK用: spaces(group_id, org_id) → space_groups(id, org_id)
);

CREATE INDEX IF NOT EXISTS idx_space_groups_org
  ON space_groups (org_id, sort_order);

-- RLS
ALTER TABLE space_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can view space_groups"
  ON space_groups FOR SELECT
  USING (
    org_id IN (
      SELECT om.org_id FROM org_memberships om WHERE om.user_id = auth.uid()
    )
  );

CREATE POLICY "org admins can manage space_groups"
  ON space_groups FOR ALL
  USING (
    org_id IN (
      SELECT om.org_id FROM org_memberships om
      WHERE om.user_id = auth.uid() AND om.role IN ('owner', 'admin')
    )
  );

-- 3. Add group reference and sort order to spaces
ALTER TABLE spaces ADD COLUMN IF NOT EXISTS group_id uuid NULL;
ALTER TABLE spaces ADD COLUMN IF NOT EXISTS sort_order int NOT NULL DEFAULT 0;

-- 複合FK: 同一org内のグループのみ紐付け可能
ALTER TABLE spaces ADD CONSTRAINT fk_spaces_group
  FOREIGN KEY (group_id, org_id) REFERENCES space_groups(id, org_id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_spaces_group ON spaces (group_id, sort_order);
