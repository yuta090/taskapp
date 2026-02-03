-- API Keys for MCP Server integration
-- Allows admins to generate API keys for external integrations

-- =============================================================================
-- 1) api_keys table
-- =============================================================================

CREATE TABLE IF NOT EXISTS api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  key_hash text NOT NULL,           -- SHA-256 hash of the key
  key_prefix text NOT NULL,         -- First 8 chars for display (e.g., "tsk_abc1...")
  created_by uuid NOT NULL REFERENCES auth.users(id),
  last_used_at timestamptz,
  expires_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS api_keys_org_space_idx ON api_keys(org_id, space_id);
CREATE INDEX IF NOT EXISTS api_keys_key_hash_idx ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS api_keys_active_idx ON api_keys(is_active) WHERE is_active = true;

-- RLS
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

-- Policy: org owners and space admins can manage API keys
CREATE POLICY api_keys_admin_policy ON api_keys
  FOR ALL
  USING (
    -- Org owner
    EXISTS (
      SELECT 1 FROM org_memberships om
      WHERE om.org_id = api_keys.org_id
        AND om.user_id = auth.uid()
        AND om.role = 'owner'
    )
    OR
    -- Space admin
    EXISTS (
      SELECT 1 FROM space_memberships sm
      WHERE sm.space_id = api_keys.space_id
        AND sm.user_id = auth.uid()
        AND sm.role = 'admin'
    )
  );

-- =============================================================================
-- 2) RPC function to validate API key
-- =============================================================================

CREATE OR REPLACE FUNCTION rpc_validate_api_key(p_api_key text)
RETURNS TABLE (
  org_id uuid,
  space_id uuid,
  key_id uuid
) AS $$
DECLARE
  v_key_hash text;
BEGIN
  -- Hash the provided key
  v_key_hash := encode(digest(p_api_key, 'sha256'), 'hex');

  -- Find and return matching active key
  RETURN QUERY
  SELECT ak.org_id, ak.space_id, ak.id
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
