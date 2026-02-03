-- Migration: AT-011 - Trigger Edge Function on meeting end
-- This creates a trigger to invoke send-meeting-minutes Edge Function

-- Note: This requires pg_net extension to be enabled in Supabase
-- Enable via Dashboard: Database > Extensions > pg_net

-- SECURITY: Secrets table for Edge Function credentials
-- This table is only accessible to service_role and this SECURITY DEFINER function
-- In production, consider using Supabase Vault instead
CREATE TABLE IF NOT EXISTS _edge_function_config (
  key text PRIMARY KEY,
  value text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Restrict access to secrets table
REVOKE ALL ON _edge_function_config FROM PUBLIC;
REVOKE ALL ON _edge_function_config FROM anon;
REVOKE ALL ON _edge_function_config FROM authenticated;
-- Only service_role and postgres can access this table

COMMENT ON TABLE _edge_function_config IS
  'Internal config for Edge Function credentials. Only accessible to service_role. ' ||
  'Keys: edge_function_url, service_role_key. ' ||
  'For production, migrate to Supabase Vault.';

-- Create function to invoke Edge Function via pg_net
CREATE OR REPLACE FUNCTION trigger_send_meeting_minutes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_edge_function_url text;
  v_service_role_key text;
BEGIN
  -- Only trigger when status changes to 'ended'
  IF NEW.status = 'ended' AND (OLD.status IS NULL OR OLD.status != 'ended') THEN
    -- Get Edge Function URL from secure config table
    -- SECURITY: This table is only readable by service_role
    SELECT value INTO v_edge_function_url
    FROM _edge_function_config
    WHERE key = 'edge_function_url';

    SELECT value INTO v_service_role_key
    FROM _edge_function_config
    WHERE key = 'service_role_key';

    -- If settings are not configured, skip (graceful degradation)
    IF v_edge_function_url IS NULL OR v_service_role_key IS NULL THEN
      RAISE NOTICE 'Edge Function URL or service key not configured, skipping trigger';
      RETURN NEW;
    END IF;

    -- Invoke Edge Function asynchronously via pg_net
    -- This is non-blocking and won't slow down the UPDATE
    PERFORM net.http_post(
      url := v_edge_function_url || '/send-meeting-minutes',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_role_key
      ),
      body := jsonb_build_object('meeting_id', NEW.id)
    );

    RAISE NOTICE 'Triggered send-meeting-minutes for meeting %', NEW.id;
  END IF;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Log error but don't fail the transaction
    RAISE WARNING 'Failed to trigger Edge Function: %', SQLERRM;
    RETURN NEW;
END;
$$;

-- Create trigger on meetings table
DROP TRIGGER IF EXISTS trg_send_meeting_minutes ON meetings;
CREATE TRIGGER trg_send_meeting_minutes
  AFTER UPDATE ON meetings
  FOR EACH ROW
  EXECUTE FUNCTION trigger_send_meeting_minutes();

-- Alternative: Manual invocation via RPC for environments without pg_net
-- This can be called from the frontend after meeting end
CREATE OR REPLACE FUNCTION rpc_invoke_meeting_minutes_email(
  p_meeting_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meeting meetings%ROWTYPE;
  v_actor_id uuid;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Authorization check FIRST to prevent meeting ID enumeration
  -- STRICT: Only meeting participants can trigger (not space members)
  -- Returns generic error regardless of whether meeting exists
  IF NOT EXISTS (
    SELECT 1 FROM meeting_participants mp
    WHERE mp.meeting_id = p_meeting_id AND mp.user_id = v_actor_id
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Get meeting (only after authorization confirmed)
  SELECT * INTO v_meeting FROM meetings WHERE id = p_meeting_id;
  IF NOT FOUND THEN
    -- Should not happen if participant exists, but handle gracefully
    RAISE EXCEPTION 'Meeting not found';
  END IF;

  -- Validate meeting is ended
  IF v_meeting.status != 'ended' THEN
    RAISE EXCEPTION 'Meeting has not ended';
  END IF;

  -- Return meeting info for frontend to invoke Edge Function
  RETURN jsonb_build_object(
    'ok', true,
    'meeting_id', p_meeting_id,
    'should_invoke_edge_function', true
  );
END;
$$;

GRANT EXECUTE ON FUNCTION rpc_invoke_meeting_minutes_email TO authenticated;

-- ============================================================
-- SETUP INSTRUCTIONS
-- ============================================================
--
-- After running this migration, configure the Edge Function credentials:
--
-- 1. Enable pg_net extension in Supabase Dashboard:
--    Database > Extensions > pg_net
--
-- 2. Insert credentials into _edge_function_config (run as service_role):
--    INSERT INTO _edge_function_config (key, value) VALUES
--      ('edge_function_url', 'https://your-project.supabase.co/functions/v1'),
--      ('service_role_key', 'your-service-role-key')
--    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
--
-- 3. Deploy the Edge Function:
--    supabase functions deploy send-meeting-minutes
--
-- SECURITY NOTE:
-- - The _edge_function_config table is only accessible to service_role
-- - For production, consider migrating to Supabase Vault
-- - Never expose service_role_key to client applications
-- ============================================================
