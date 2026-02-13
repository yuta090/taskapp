-- Migration: Security fixes for scheduling feature (Code Review findings)
-- Fixes: RPC auth, RLS cross-proposal, GRANT/REVOKE, missing indexes

-- =============================================================================
-- 1) Fix RPC: Add auth check + GRANT/REVOKE
-- =============================================================================

CREATE OR REPLACE FUNCTION rpc_confirm_proposal_slot(
  p_proposal_id uuid,
  p_slot_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_proposal scheduling_proposals%ROWTYPE;
  v_slot proposal_slots%ROWTYPE;
  v_meeting_id uuid;
  v_required_count integer;
  v_eligible_count integer;
  v_is_authorized boolean := false;
BEGIN
  -- Auth check
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'authentication_required');
  END IF;

  -- 1. Row lock
  SELECT * INTO v_proposal
  FROM scheduling_proposals
  WHERE id = p_proposal_id
  FOR UPDATE;

  IF v_proposal IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'proposal_not_found');
  END IF;

  -- 2. Authorization: creator or space admin
  IF v_proposal.created_by = v_actor_id THEN
    v_is_authorized := true;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM space_memberships
      WHERE space_id = v_proposal.space_id
        AND user_id = v_actor_id
        AND role = 'admin'
    ) INTO v_is_authorized;
  END IF;

  IF NOT v_is_authorized THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;

  -- 3. Status guard
  IF v_proposal.status <> 'open' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'proposal_not_open', 'current_status', v_proposal.status);
  END IF;

  -- 4. Slot belongs to this proposal
  SELECT * INTO v_slot
  FROM proposal_slots
  WHERE id = p_slot_id AND proposal_id = p_proposal_id;

  IF v_slot IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'slot_not_found');
  END IF;

  -- 5. Required respondent count (must be > 0)
  SELECT count(*) INTO v_required_count
  FROM proposal_respondents
  WHERE proposal_id = p_proposal_id AND is_required = true;

  IF v_required_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_required_respondents');
  END IF;

  -- 6. Eligible count: explicitly constrain both slot AND proposal
  SELECT count(*) INTO v_eligible_count
  FROM slot_responses sr
  JOIN proposal_respondents pr ON sr.respondent_id = pr.id
  WHERE sr.slot_id = p_slot_id
    AND pr.proposal_id = p_proposal_id
    AND pr.is_required = true
    AND sr.response IN ('available', 'unavailable_but_proceed');

  IF v_eligible_count < v_required_count THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'not_all_agreed',
      'required', v_required_count,
      'eligible', v_eligible_count
    );
  END IF;

  -- 7. Create meeting
  INSERT INTO meetings (org_id, space_id, title, held_at, status, created_by)
  VALUES (
    v_proposal.org_id,
    v_proposal.space_id,
    v_proposal.title,
    v_slot.start_at,
    'planned',
    v_actor_id
  )
  RETURNING id INTO v_meeting_id;

  -- 8. Copy participants
  INSERT INTO meeting_participants (org_id, space_id, meeting_id, user_id, side, created_by)
  SELECT
    v_proposal.org_id,
    v_proposal.space_id,
    v_meeting_id,
    pr.user_id,
    pr.side,
    v_actor_id
  FROM proposal_respondents pr
  WHERE pr.proposal_id = p_proposal_id;

  -- 9. Update proposal
  UPDATE scheduling_proposals
  SET status = 'confirmed',
      confirmed_slot_id = p_slot_id,
      confirmed_meeting_id = v_meeting_id,
      confirmed_at = now(),
      confirmed_by = v_actor_id,
      version = version + 1
  WHERE id = p_proposal_id;

  RETURN jsonb_build_object(
    'ok', true,
    'meeting_id', v_meeting_id,
    'slot_start', v_slot.start_at,
    'slot_end', v_slot.end_at
  );
END;
$$;

-- Restrict RPC access
REVOKE EXECUTE ON FUNCTION rpc_confirm_proposal_slot FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION rpc_confirm_proposal_slot FROM anon;
GRANT EXECUTE ON FUNCTION rpc_confirm_proposal_slot TO authenticated;

-- =============================================================================
-- 2) Fix RLS: slot_responses cross-proposal prevention
--    Ensure slot and respondent belong to the same proposal
-- =============================================================================

-- Drop old policies
DROP POLICY IF EXISTS "respondents can insert own responses" ON slot_responses;
DROP POLICY IF EXISTS "respondents can update own responses" ON slot_responses;

-- Recreated with proposal-match check
CREATE POLICY "respondents can insert own responses"
  ON slot_responses FOR INSERT
  WITH CHECK (
    respondent_id IN (
      SELECT pr.id FROM proposal_respondents pr WHERE pr.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1
      FROM proposal_slots ps
      JOIN proposal_respondents pr ON pr.proposal_id = ps.proposal_id
      WHERE ps.id = slot_responses.slot_id
        AND pr.id = slot_responses.respondent_id
    )
  );

CREATE POLICY "respondents can update own responses"
  ON slot_responses FOR UPDATE
  USING (
    respondent_id IN (
      SELECT pr.id FROM proposal_respondents pr WHERE pr.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1
      FROM proposal_slots ps
      JOIN proposal_respondents pr ON pr.proposal_id = ps.proposal_id
      WHERE ps.id = slot_responses.slot_id
        AND pr.id = slot_responses.respondent_id
    )
  );

-- =============================================================================
-- 3) Add missing indexes for pg_cron performance
-- =============================================================================

CREATE INDEX IF NOT EXISTS scheduling_proposals_open_expires_idx
  ON scheduling_proposals(expires_at)
  WHERE status = 'open' AND expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS scheduling_proposals_open_created_idx
  ON scheduling_proposals(created_at)
  WHERE status = 'open';

-- =============================================================================
-- 4) Add DB constraint: slot_responses slot and respondent must share proposal
--    Trigger-based approach (since composite FK is complex with uuid PKs)
-- =============================================================================

CREATE OR REPLACE FUNCTION check_slot_response_proposal_match()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_slot_proposal_id uuid;
  v_respondent_proposal_id uuid;
BEGIN
  SELECT proposal_id INTO v_slot_proposal_id
  FROM proposal_slots WHERE id = NEW.slot_id;

  SELECT proposal_id INTO v_respondent_proposal_id
  FROM proposal_respondents WHERE id = NEW.respondent_id;

  IF v_slot_proposal_id IS DISTINCT FROM v_respondent_proposal_id THEN
    RAISE EXCEPTION 'slot and respondent must belong to the same proposal';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_slot_response_proposal ON slot_responses;
CREATE TRIGGER trg_check_slot_response_proposal
  BEFORE INSERT OR UPDATE ON slot_responses
  FOR EACH ROW
  EXECUTE FUNCTION check_slot_response_proposal_match();
