-- Postgres DDL v0.2 (Migration + Additions)
-- Apply on top of DDL v0.1
--
-- Adds
-- - tasks: status=considering, ball/origin, type(spec), spec_path, decision_state
-- - task_owners: client/internal owners (ball owners)
-- - task_events: audit log with actor vs onBehalfOf separation (payload)
-- - meetings: status + started_at/ended_at + minutes(md)
-- - meeting_participants
-- - reviews + review_approvals
-- - notifications (in-app/email outbox)
--
-- Notes
-- - v0.1 の tasks.status は inline CHECK で constraint 名が自動生成。
--   既存DBでは DO ブロックで該当CHECKを探索してDROPし、命名した constraint を付け直す。

create extension if not exists pgcrypto;

-- =============================================================================
-- 0) tasks
-- =============================================================================

-- 0-1) Drop existing CHECK constraint(s) for tasks.status (generated name in v0.1)
DO $$
DECLARE c record;
BEGIN
  -- tasks テーブルが無い場合は何もしない
  PERFORM 1 FROM information_schema.tables WHERE table_name='tasks';
  IF NOT FOUND THEN
    RETURN;
  END IF;

  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'tasks'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%in%'
  LOOP
    -- statusに関するCHECKだけを落とす（他のCHECKは残す）
    IF pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname=c.conname AND conrelid='tasks'::regclass)) ILIKE '%status%in%' THEN
      EXECUTE format('ALTER TABLE tasks DROP CONSTRAINT IF EXISTS %I', c.conname);
    END IF;
  END LOOP;
END $$;

-- 0-2) Re-add status constraint with considering
ALTER TABLE tasks
  ADD CONSTRAINT IF NOT EXISTS tasks_status_chk
  CHECK (status IN ('backlog','todo','in_progress','in_review','done','considering'));

-- 0-3) Add flow/spec columns
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS ball text NOT NULL DEFAULT 'internal' CHECK (ball IN ('client','internal')),
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'internal' CHECK (origin IN ('client','internal')),
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'task' CHECK (type IN ('task','spec')),
  ADD COLUMN IF NOT EXISTS spec_path text NULL,
  ADD COLUMN IF NOT EXISTS decision_state text NULL CHECK (decision_state IN ('considering','decided','implemented'));

-- 0-4) SPEC task requirements (file + anchor required, decision_state required)
ALTER TABLE tasks
  ADD CONSTRAINT IF NOT EXISTS tasks_spec_required_chk
  CHECK (
    type <> 'spec'
    OR (
      spec_path IS NOT NULL
      AND spec_path LIKE '/spec/%#%'
      AND decision_state IS NOT NULL
    )
  );

-- 0-5) Helpful indexes
CREATE INDEX IF NOT EXISTS tasks_type_state_idx ON tasks(type, decision_state);
CREATE INDEX IF NOT EXISTS tasks_ball_idx ON tasks(ball);
CREATE INDEX IF NOT EXISTS tasks_origin_idx ON tasks(origin);


-- =============================================================================
-- 1) task_owners (ball owners)
-- =============================================================================

CREATE TABLE IF NOT EXISTS task_owners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  side text NOT NULL CHECK (side IN ('client','internal')),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, side, user_id)
);

CREATE INDEX IF NOT EXISTS task_owners_task_side_idx ON task_owners(task_id, side);


-- =============================================================================
-- 2) meetings (lifecycle + minutes)
-- =============================================================================

-- 2-1) meetings: add lifecycle fields (v0.1: held_at exists)
ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','ended')),
  ADD COLUMN IF NOT EXISTS started_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS ended_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS minutes_md text NULL,
  ADD COLUMN IF NOT EXISTS summary_subject text NULL,
  ADD COLUMN IF NOT EXISTS summary_body text NULL;

CREATE INDEX IF NOT EXISTS meetings_space_status_idx ON meetings(space_id, status, held_at DESC);

-- 2-2) meeting participants (client/internal)
CREATE TABLE IF NOT EXISTS meeting_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  side text NOT NULL CHECK (side IN ('client','internal')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (meeting_id, user_id)
);

CREATE INDEX IF NOT EXISTS meeting_participants_meeting_idx ON meeting_participants(meeting_id);


-- =============================================================================
-- 3) task_events (audit)
-- =============================================================================

CREATE TABLE IF NOT EXISTS task_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  meeting_id uuid NULL REFERENCES meetings(id) ON DELETE SET NULL,
  action text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_events_task_id_idx ON task_events(task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS task_events_meeting_id_idx ON task_events(meeting_id, created_at DESC);


-- =============================================================================
-- 4) reviews
-- =============================================================================

CREATE TABLE IF NOT EXISTS reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','approved','changes_requested')),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id)
);

CREATE TABLE IF NOT EXISTS review_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  review_id uuid NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','approved','blocked')),
  blocked_reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (review_id, reviewer_id)
);

CREATE INDEX IF NOT EXISTS reviews_task_idx ON reviews(task_id);
CREATE INDEX IF NOT EXISTS review_approvals_review_idx ON review_approvals(review_id);


-- =============================================================================
-- 5) notifications (in-app/email)
-- =============================================================================

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  to_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('in_app','email')),
  type text NOT NULL,
  dedupe_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz NULL,
  UNIQUE (to_user_id, channel, dedupe_key)
);

CREATE INDEX IF NOT EXISTS notifications_to_user_idx ON notifications(to_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_space_idx ON notifications(space_id, created_at DESC);

