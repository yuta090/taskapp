-- Migration: Phase 4 — Scheduling auto-expiration & reminders
-- Requires: pg_cron extension (enable via Supabase Dashboard)
-- Optional: pg_net extension for Slack notifications

-- =============================================================================
-- 1) Reminder log table (prevents duplicate sends)
-- =============================================================================

CREATE TABLE IF NOT EXISTS scheduling_reminder_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid NOT NULL REFERENCES scheduling_proposals(id) ON DELETE CASCADE,
  reminder_type text NOT NULL CHECK (reminder_type IN ('expiry_24h', 'unresponded_48h', 'proposal_expired')),
  target_user_id uuid NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (proposal_id, reminder_type, target_user_id)
);

CREATE INDEX IF NOT EXISTS scheduling_reminder_log_proposal_idx
  ON scheduling_reminder_log(proposal_id);

ALTER TABLE scheduling_reminder_log ENABLE ROW LEVEL SECURITY;
-- No RLS policies = only service_role/postgres can access

-- =============================================================================
-- 2) process_scheduling_expirations()
--    Runs every 5 minutes. Expires overdue proposals + creates in_app notifications.
-- =============================================================================

CREATE OR REPLACE FUNCTION process_scheduling_expirations()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expired_count integer := 0;
  v_proposal record;
BEGIN
  -- Find and expire overdue open proposals
  FOR v_proposal IN
    UPDATE scheduling_proposals
    SET status = 'expired', updated_at = now()
    WHERE status = 'open'
      AND expires_at IS NOT NULL
      AND expires_at < now()
    RETURNING id, org_id, space_id, created_by, title
  LOOP
    v_expired_count := v_expired_count + 1;

    -- Notify the creator that their proposal expired
    INSERT INTO notifications (id, org_id, space_id, to_user_id, channel, type, dedupe_key, payload, created_at)
    VALUES (
      gen_random_uuid(),
      v_proposal.org_id,
      v_proposal.space_id,
      v_proposal.created_by,
      'in_app',
      'scheduling_proposal_expired',
      'scheduling_expired:' || v_proposal.id,
      jsonb_build_object(
        'proposalId', v_proposal.id,
        'title', v_proposal.title,
        'message', '日程調整「' || v_proposal.title || '」が期限切れになりました'
      ),
      now()
    )
    ON CONFLICT (to_user_id, channel, dedupe_key) DO NOTHING;

    -- Log to prevent re-processing
    INSERT INTO scheduling_reminder_log (proposal_id, reminder_type, target_user_id)
    VALUES (v_proposal.id, 'proposal_expired', v_proposal.created_by)
    ON CONFLICT DO NOTHING;
  END LOOP;

  RETURN jsonb_build_object('expired_count', v_expired_count);
END;
$$;

-- =============================================================================
-- 3) process_scheduling_reminders()
--    Runs every 15 minutes. Sends two types of reminders:
--    a) 24h before expiry → unresponded respondents
--    b) 48h after creation → creator about unresponsive respondents
-- =============================================================================

CREATE OR REPLACE FUNCTION process_scheduling_reminders()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expiry_count integer := 0;
  v_unresponded_count integer := 0;
  v_proposal record;
  v_respondent record;
  v_unresponded_names text;
BEGIN
  -- =========================================================================
  -- (a) 24h before expiry: remind each unresponded respondent
  -- =========================================================================
  FOR v_proposal IN
    SELECT sp.id, sp.title, sp.org_id, sp.space_id, sp.expires_at
    FROM scheduling_proposals sp
    WHERE sp.status = 'open'
      AND sp.expires_at IS NOT NULL
      AND sp.expires_at > now()
      AND sp.expires_at <= now() + interval '24 hours'
  LOOP
    FOR v_respondent IN
      SELECT pr.id AS respondent_id, pr.user_id
      FROM proposal_respondents pr
      WHERE pr.proposal_id = v_proposal.id
        -- Has not responded to ANY slot
        AND NOT EXISTS (
          SELECT 1 FROM slot_responses sr
          WHERE sr.respondent_id = pr.id
        )
        -- Reminder not yet sent
        AND NOT EXISTS (
          SELECT 1 FROM scheduling_reminder_log srl
          WHERE srl.proposal_id = v_proposal.id
            AND srl.reminder_type = 'expiry_24h'
            AND srl.target_user_id = pr.user_id
        )
    LOOP
      INSERT INTO notifications (id, org_id, space_id, to_user_id, channel, type, dedupe_key, payload, created_at)
      VALUES (
        gen_random_uuid(),
        v_proposal.org_id,
        v_proposal.space_id,
        v_respondent.user_id,
        'in_app',
        'scheduling_reminder',
        'scheduling_expiry_24h:' || v_proposal.id || ':' || v_respondent.user_id,
        jsonb_build_object(
          'proposalId', v_proposal.id,
          'title', v_proposal.title,
          'reminderType', 'expiry_24h',
          'expiresAt', v_proposal.expires_at,
          'message', '日程調整「' || v_proposal.title || '」の回答期限が明日です。まだ回答していません。'
        ),
        now()
      )
      ON CONFLICT (to_user_id, channel, dedupe_key) DO NOTHING;

      INSERT INTO scheduling_reminder_log (proposal_id, reminder_type, target_user_id)
      VALUES (v_proposal.id, 'expiry_24h', v_respondent.user_id)
      ON CONFLICT DO NOTHING;

      v_expiry_count := v_expiry_count + 1;
    END LOOP;
  END LOOP;

  -- =========================================================================
  -- (b) 48h after creation: notify creator about unresponsive respondents
  -- =========================================================================
  FOR v_proposal IN
    SELECT sp.id, sp.title, sp.org_id, sp.space_id, sp.created_by
    FROM scheduling_proposals sp
    WHERE sp.status = 'open'
      AND sp.created_at < now() - interval '48 hours'
      -- Creator reminder not yet sent
      AND NOT EXISTS (
        SELECT 1 FROM scheduling_reminder_log srl
        WHERE srl.proposal_id = sp.id
          AND srl.reminder_type = 'unresponded_48h'
          AND srl.target_user_id = sp.created_by
      )
  LOOP
    -- Build comma-separated list of unresponded user display names
    SELECT string_agg(p.display_name, '、' ORDER BY p.display_name)
    INTO v_unresponded_names
    FROM proposal_respondents pr
    JOIN profiles p ON p.id = pr.user_id
    WHERE pr.proposal_id = v_proposal.id
      AND NOT EXISTS (
        SELECT 1 FROM slot_responses sr
        WHERE sr.respondent_id = pr.id
      );

    -- Only send if there are actually unresponded people
    IF v_unresponded_names IS NOT NULL THEN
      INSERT INTO notifications (id, org_id, space_id, to_user_id, channel, type, dedupe_key, payload, created_at)
      VALUES (
        gen_random_uuid(),
        v_proposal.org_id,
        v_proposal.space_id,
        v_proposal.created_by,
        'in_app',
        'scheduling_reminder',
        'scheduling_unresponded_48h:' || v_proposal.id,
        jsonb_build_object(
          'proposalId', v_proposal.id,
          'title', v_proposal.title,
          'reminderType', 'unresponded_48h',
          'unrespondedNames', v_unresponded_names,
          'message', v_unresponded_names || 'さんがまだ「' || v_proposal.title || '」に回答していません。'
        ),
        now()
      )
      ON CONFLICT (to_user_id, channel, dedupe_key) DO NOTHING;

      INSERT INTO scheduling_reminder_log (proposal_id, reminder_type, target_user_id)
      VALUES (v_proposal.id, 'unresponded_48h', v_proposal.created_by)
      ON CONFLICT DO NOTHING;

      v_unresponded_count := v_unresponded_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'expiry_reminders', v_expiry_count,
    'unresponded_reminders', v_unresponded_count
  );
END;
$$;

-- =============================================================================
-- 4) pg_cron schedules
-- =============================================================================
-- NOTE: pg_cron must be enabled first via Supabase Dashboard:
--   Database > Extensions > pg_cron
--
-- After enabling, run these manually:
--
--   SELECT cron.schedule(
--     'scheduling-expire-proposals',
--     '*/5 * * * *',
--     $$SELECT process_scheduling_expirations()$$
--   );
--
--   SELECT cron.schedule(
--     'scheduling-reminders',
--     '*/15 * * * *',
--     $$SELECT process_scheduling_reminders()$$
--   );
--
-- To verify schedules:
--   SELECT * FROM cron.job;
--
-- To remove schedules:
--   SELECT cron.unschedule('scheduling-expire-proposals');
--   SELECT cron.unschedule('scheduling-reminders');
-- =============================================================================
