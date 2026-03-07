-- Announcements: org-wide notifications for new features, updates, etc.

CREATE TABLE IF NOT EXISTS announcements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid REFERENCES organizations(id) ON DELETE CASCADE,
  title       text NOT NULL,
  body        text NOT NULL DEFAULT '',
  category    text NOT NULL DEFAULT 'info'
                CHECK (category IN ('info', 'feature', 'maintenance', 'important')),
  published   boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Track which users have read which announcements
CREATE TABLE IF NOT EXISTS announcement_reads (
  announcement_id uuid NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  read_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, user_id)
);

-- org_id NULL = system-wide announcement (visible to all orgs)
CREATE INDEX idx_announcements_org ON announcements (org_id, published, created_at DESC);
CREATE INDEX idx_announcement_reads_user ON announcement_reads (user_id);

-- RLS
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcement_reads ENABLE ROW LEVEL SECURITY;

-- Anyone in the org can read announcements (or system-wide where org_id IS NULL)
CREATE POLICY "Users can read announcements"
  ON announcements FOR SELECT
  USING (
    published = true
    AND (
      org_id IS NULL
      OR org_id IN (
        SELECT org_id FROM org_memberships WHERE user_id = auth.uid()
      )
    )
  );

-- Only org admins can insert/update/delete
CREATE POLICY "Admins can manage announcements"
  ON announcements FOR ALL
  USING (
    org_id IN (
      SELECT org_id FROM org_memberships
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- Users can read their own read-marks
CREATE POLICY "Users can read own announcement_reads"
  ON announcement_reads FOR SELECT
  USING (user_id = auth.uid());

-- Users can mark announcements as read
CREATE POLICY "Users can mark announcements read"
  ON announcement_reads FOR INSERT
  WITH CHECK (user_id = auth.uid());
