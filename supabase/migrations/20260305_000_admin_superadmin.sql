-- Add superadmin flag to profiles table
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_superadmin boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS profiles_superadmin_idx
  ON profiles (id) WHERE is_superadmin = true;

-- RPC: Check if current user is superadmin
CREATE OR REPLACE FUNCTION rpc_is_superadmin()
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND is_superadmin = true
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION rpc_is_superadmin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rpc_is_superadmin() TO authenticated;
