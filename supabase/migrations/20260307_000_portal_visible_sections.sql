-- Portal Visible Sections: スペース単位でポータル表示項目を制御
-- agency_mode に関係なく全スペースで有効

ALTER TABLE spaces ADD COLUMN portal_visible_sections jsonb
  NOT NULL DEFAULT '{"tasks": true, "requests": true, "all_tasks": true, "files": true, "meetings": true, "wiki": false, "history": true}';

COMMENT ON COLUMN spaces.portal_visible_sections IS 'クライアントポータルに表示するセクションのトグル設定';
