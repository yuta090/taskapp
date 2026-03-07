-- Portal Visible Sections: スペース単位でポータル表示項目を制御
-- agency_mode に関係なく全スペースで有効

ALTER TABLE spaces ADD COLUMN portal_visible_sections jsonb
  NOT NULL DEFAULT '{"tasks": true, "requests": true, "all_tasks": true, "files": true, "meetings": true, "wiki": false, "history": true}';

-- Validate JSONB shape: all required keys must be boolean
ALTER TABLE spaces ADD CONSTRAINT chk_portal_visible_sections CHECK (
  portal_visible_sections IS NOT NULL
  AND (portal_visible_sections->>'tasks') IS NOT NULL
  AND (portal_visible_sections->>'requests') IS NOT NULL
  AND (portal_visible_sections->>'all_tasks') IS NOT NULL
  AND (portal_visible_sections->>'files') IS NOT NULL
  AND (portal_visible_sections->>'meetings') IS NOT NULL
  AND (portal_visible_sections->>'wiki') IS NOT NULL
  AND (portal_visible_sections->>'history') IS NOT NULL
  AND jsonb_typeof(portal_visible_sections->'tasks') = 'boolean'
  AND jsonb_typeof(portal_visible_sections->'requests') = 'boolean'
  AND jsonb_typeof(portal_visible_sections->'all_tasks') = 'boolean'
  AND jsonb_typeof(portal_visible_sections->'files') = 'boolean'
  AND jsonb_typeof(portal_visible_sections->'meetings') = 'boolean'
  AND jsonb_typeof(portal_visible_sections->'wiki') = 'boolean'
  AND jsonb_typeof(portal_visible_sections->'history') = 'boolean'
);

COMMENT ON COLUMN spaces.portal_visible_sections IS 'クライアントポータルに表示するセクションのトグル設定';
