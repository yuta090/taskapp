-- Migration: Add `link` to scheduling_reminder / scheduling_proposal_expired payloads
--
-- Bug: 20260216_000_scheduling_cron.sql's process_scheduling_expirations() and
-- process_scheduling_reminders() insert notifications without a `link` (or
-- `task_id`) in payload. NotificationInspector only renders a "詳細を見る" /
-- type-specific action button when payload.link is present, so recipients of
-- these notifications had no way to reach the scheduling response screen.
--
-- Fix: redefine both functions to include `link`, routed by the recipient's
-- role:
--   - internal user  -> `/{orgId}/project/{spaceId}/meetings?proposal={id}`
--     (matches MeetingsPageClient.tsx's `updateQuery({ proposal: ... })` deep link)
--   - client (proposal_respondents.side = 'client') -> `/portal/scheduling`
--     (matches PortalSchedulingClient.tsx's route; it lists all open proposals
--     for the client's current project, there is no per-proposal deep link yet)
--
-- Proposal creators (scheduling_proposal_expired, and the 48h "unresponded"
-- reminder to the creator) are always internal users — only the internal
-- `/api/scheduling/proposals` route creates proposals.
--
-- 適用: DBへ適用しない（別途 psql 個別適用 + applied_migrations へ記録）

CREATE OR REPLACE FUNCTION process_scheduling_expirations()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expired_count integer := 0;
  v_proposal record;
  v_link text;
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

    -- Creator is always an internal user (only the internal proposal-creation
    -- route creates proposals) -> always the meetings page deep link.
    v_link := '/' || v_proposal.org_id || '/project/' || v_proposal.space_id
      || '/meetings?proposal=' || v_proposal.id;

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
        'link', v_link,
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
  v_link text;
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
      SELECT pr.id AS respondent_id, pr.user_id, pr.side
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
      v_link := CASE
        WHEN v_respondent.side = 'client' THEN '/portal/scheduling'
        ELSE '/' || v_proposal.org_id || '/project/' || v_proposal.space_id
          || '/meetings?proposal=' || v_proposal.id
      END;

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
          'link', v_link,
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
      -- Creator is always an internal user -> always the meetings page deep link.
      v_link := '/' || v_proposal.org_id || '/project/' || v_proposal.space_id
        || '/meetings?proposal=' || v_proposal.id;

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
          'link', v_link,
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
