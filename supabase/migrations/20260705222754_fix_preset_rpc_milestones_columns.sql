-- Migration: preset RPCのmilestones INSERTから存在しない列を除去
--
-- 不具合: rpc_create_space_with_preset / rpc_apply_preset_to_space が
-- milestones (org_id, space_id, name, order_key, created_by, updated_by) へ
-- INSERTするが、milestonesテーブルに created_by / updated_by 列は存在しない
-- （20240101_000_schema.sql 参照。wiki_pagesには両列があり、そちらは正しい）。
-- このため milestones が1件でもあるプリセット＝白紙以外の全テンプレートが
-- 「column "created_by" of relation "milestones" does not exist」で失敗していた。
-- 実ブラウザでのオンボーディング検証（2026-07-05）で発見。
--
-- 修正: 両RPCを CREATE OR REPLACE し、milestones INSERT を実スキーマに合わせる。
-- 本体ロジックは 20260219_000_preset_genre.sql / 20260221_000_apply_preset.sql と同一。

-- 1. rpc_create_space_with_preset
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

  -- 5. Bulk create milestones（created_by/updated_byはmilestonesに存在しない）
  FOR v_milestone_record IN
    SELECT * FROM jsonb_to_recordset(p_milestones)
      AS x(name text, order_key numeric)
  LOOP
    INSERT INTO milestones (org_id, space_id, name, order_key)
    VALUES (p_org_id, v_space_id, v_milestone_record.name, v_milestone_record.order_key);
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

-- 2. rpc_apply_preset_to_space
CREATE OR REPLACE FUNCTION rpc_apply_preset_to_space(
  p_space_id uuid,
  p_preset_genre text,
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
  v_org_id uuid;
  v_current_genre text;
  v_wiki_count int;
  v_ms_count int;
  v_milestone_record record;
  v_page_record record;
  v_created_ms int := 0;
  v_created_wp int := 0;
BEGIN
  -- 1. Auth check
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'authentication_required');
  END IF;

  -- 2. Fetch space
  SELECT org_id, preset_genre INTO v_org_id, v_current_genre
  FROM spaces WHERE id = p_space_id;

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'space_not_found');
  END IF;

  -- 3. Permission check (admin or editor on the space)
  IF NOT EXISTS (
    SELECT 1 FROM space_memberships
    WHERE space_id = p_space_id AND user_id = v_user_id AND role IN ('admin', 'editor')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient_permissions');
  END IF;

  -- 4. Safety: reject if preset already applied (non-null, non-blank)
  IF v_current_genre IS NOT NULL AND v_current_genre != 'blank' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'preset_already_applied');
  END IF;

  -- 5. Safety: only apply when BOTH wiki AND milestones are empty
  SELECT count(*) INTO v_wiki_count FROM wiki_pages WHERE space_id = p_space_id;
  SELECT count(*) INTO v_ms_count FROM milestones WHERE space_id = p_space_id;

  IF v_wiki_count > 0 OR v_ms_count > 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'space_not_empty',
      'wiki_count', v_wiki_count,
      'ms_count', v_ms_count
    );
  END IF;

  -- 6. Update space preset_genre
  UPDATE spaces SET preset_genre = p_preset_genre WHERE id = p_space_id;

  -- 7. Update owner_field_enabled if provided
  IF p_owner_field_enabled IS NOT NULL THEN
    UPDATE spaces SET owner_field_enabled = p_owner_field_enabled WHERE id = p_space_id;
  END IF;

  -- 8. Bulk create milestones（created_by/updated_byはmilestonesに存在しない）
  FOR v_milestone_record IN
    SELECT * FROM jsonb_to_recordset(p_milestones)
      AS x(name text, order_key numeric)
  LOOP
    INSERT INTO milestones (org_id, space_id, name, order_key)
    VALUES (v_org_id, p_space_id, v_milestone_record.name, v_milestone_record.order_key);
    v_created_ms := v_created_ms + 1;
  END LOOP;

  -- 9. Create wiki pages (non-home first, then home)
  FOR v_page_record IN
    SELECT * FROM jsonb_to_recordset(p_wiki_pages)
      AS x(title text, body text, tags jsonb, is_home boolean)
    WHERE NOT COALESCE(x.is_home, false)
  LOOP
    INSERT INTO wiki_pages (org_id, space_id, title, body, tags, created_by, updated_by)
    VALUES (
      v_org_id, p_space_id, v_page_record.title, v_page_record.body,
      ARRAY(SELECT jsonb_array_elements_text(v_page_record.tags)),
      v_user_id, v_user_id
    );
    v_created_wp := v_created_wp + 1;
  END LOOP;

  FOR v_page_record IN
    SELECT * FROM jsonb_to_recordset(p_wiki_pages)
      AS x(title text, body text, tags jsonb, is_home boolean)
    WHERE COALESCE(x.is_home, false)
  LOOP
    INSERT INTO wiki_pages (org_id, space_id, title, body, tags, created_by, updated_by)
    VALUES (
      v_org_id, p_space_id, v_page_record.title, v_page_record.body,
      ARRAY(SELECT jsonb_array_elements_text(v_page_record.tags)),
      v_user_id, v_user_id
    );
    v_created_wp := v_created_wp + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'milestones_created', v_created_ms,
    'wiki_pages_created', v_created_wp
  );
END;
$$;
