-- Migration: Add preset_genre to spaces + RPC for atomic space creation with preset
-- Adds genre-based project presets (wiki templates + milestones) on space creation

-- 1. Add preset_genre column to spaces with CHECK constraint
ALTER TABLE spaces ADD COLUMN IF NOT EXISTS preset_genre text NULL;
ALTER TABLE spaces ADD CONSTRAINT spaces_preset_genre_check
  CHECK (preset_genre IS NULL OR preset_genre IN (
    'web_development', 'system_development', 'design',
    'consulting', 'marketing', 'event',
    'legal_accounting', 'video_production', 'construction',
    'blank'
  ));
COMMENT ON COLUMN spaces.preset_genre IS
  'プリセットジャンル。NULL=旧来のspace（wiki自動生成あり）、blank=白紙（wiki自動生成なし）、その他=ジャンル名（作成時にコンテンツ適用済み）';

-- 2. RPC function for atomic space creation with preset content
CREATE OR REPLACE FUNCTION rpc_create_space_with_preset(
  p_org_id uuid,
  p_name text,
  p_preset_genre text DEFAULT 'blank',
  p_milestones jsonb DEFAULT '[]'::jsonb,
  p_wiki_pages jsonb DEFAULT '[]'::jsonb,
  p_owner_field_enabled boolean DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_space_id uuid;
  v_page_record record;
  v_milestone_record record;
  v_spec_pages jsonb := '[]'::jsonb;
  v_ms_count int := 0;
  v_wp_count int := 0;
BEGIN
  -- 1. Auth check
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'authentication_required');
  END IF;

  -- 2. Org membership check
  IF NOT EXISTS (
    SELECT 1 FROM org_memberships
    WHERE org_id = p_org_id AND user_id = v_user_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_org_member');
  END IF;

  -- 3. Create space
  INSERT INTO spaces (org_id, name, type, preset_genre, owner_field_enabled)
  VALUES (p_org_id, p_name, 'project', p_preset_genre,
          CASE WHEN p_owner_field_enabled IS NOT NULL THEN p_owner_field_enabled ELSE NULL END)
  RETURNING id INTO v_space_id;

  -- 4. Create admin membership for creator
  INSERT INTO space_memberships (space_id, user_id, role)
  VALUES (v_space_id, v_user_id, 'admin');

  -- 5. Bulk create milestones
  FOR v_milestone_record IN
    SELECT * FROM jsonb_to_recordset(p_milestones)
      AS x(name text, order_key numeric)
  LOOP
    INSERT INTO milestones (org_id, space_id, name, order_key, created_by, updated_by)
    VALUES (p_org_id, v_space_id, v_milestone_record.name, v_milestone_record.order_key, v_user_id, v_user_id);
    v_ms_count := v_ms_count + 1;
  END LOOP;

  -- 6. Create wiki pages
  -- 6a. Non-home pages first (spec pages)
  FOR v_page_record IN
    SELECT * FROM jsonb_to_recordset(p_wiki_pages)
      AS x(title text, body text, tags jsonb, is_home boolean)
    WHERE NOT COALESCE(x.is_home, false)
  LOOP
    INSERT INTO wiki_pages (org_id, space_id, title, body, tags, created_by, updated_by)
    VALUES (
      p_org_id, v_space_id, v_page_record.title, v_page_record.body,
      ARRAY(SELECT jsonb_array_elements_text(v_page_record.tags)),
      v_user_id, v_user_id
    );
    v_wp_count := v_wp_count + 1;
  END LOOP;

  -- 6b. Home page(s)
  FOR v_page_record IN
    SELECT * FROM jsonb_to_recordset(p_wiki_pages)
      AS x(title text, body text, tags jsonb, is_home boolean)
    WHERE COALESCE(x.is_home, false)
  LOOP
    INSERT INTO wiki_pages (org_id, space_id, title, body, tags, created_by, updated_by)
    VALUES (
      p_org_id, v_space_id, v_page_record.title, v_page_record.body,
      ARRAY(SELECT jsonb_array_elements_text(v_page_record.tags)),
      v_user_id, v_user_id
    );
    v_wp_count := v_wp_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'space_id', v_space_id,
    'milestones_created', v_ms_count,
    'wiki_pages_created', v_wp_count
  );
END;
$$;
