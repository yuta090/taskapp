-- =============================================================================
-- SECURITY DEFINER の関数を、呼べる人（実行権）と呼んだ人の確認で絞る
-- 確定設計: Fable 裁定 2026-09-11
--
-- 節の形（あとで関数を足すときも同じ形で足す）:
--   節 A  サーバー（service role）と DB の中の関数・定期処理からだけ呼ぶ関数 … 実行権は service_role だけ。本文は変えない。
--   節 B  rpc_create_space_with_preset … 今の定義が土台と同じか確かめてから、土台の本文に呼んだ人の確認だけを足して
--         作り直し、実行権を定める（本文に確認を足す関数は、この形で1関数1節を足す）。
--   節 C  ログイン中の画面（本人のセッション）からだけ呼ぶ関数 … 実行権は authenticated と service_role だけ。本文は変えない。
--   節 A・節 C に関数を足すときは、revoke / grant の2行・節の末尾の確認の1行・ロールバックの1行を足す。
--   各節の末尾にロールバック節（後ろの節から順に流す）。
--
-- 冪等: revoke → grant / 確認つきの create or replace。2回流しても同じ。
-- 可逆: 各節の末尾のロールバック節。データは変えない。
-- =============================================================================


-- =============================================================================
-- 節 A: 次の関数はサーバー（service role）と DB の中の関数・定期処理からだけ呼ぶ。
--   Supabase は関数を作ると anon / authenticated にも実行権を付けるため、名指しで外し、service_role にだけ付け直す。
--   本文は変えない。
-- =============================================================================

revoke execute on function public.mcp_dry_run_delete(uuid, uuid, text, uuid[]) from public, anon, authenticated;
grant execute on function public.mcp_dry_run_delete(uuid, uuid, text, uuid[]) to service_role;

revoke execute on function public.mcp_confirm_delete(uuid, text) from public, anon, authenticated;
grant execute on function public.mcp_confirm_delete(uuid, text) to service_role;

revoke execute on function public._create_task_notification(uuid, uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public._create_task_notification(uuid, uuid, uuid, text, text, jsonb) to service_role;

revoke execute on function public.mcp_authorize(uuid, uuid, uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.mcp_authorize(uuid, uuid, uuid, text, text, uuid) to service_role;

revoke execute on function public.mcp_log_usage(uuid, uuid, uuid, text, text, text, uuid, boolean, text, jsonb) from public, anon, authenticated;
grant execute on function public.mcp_log_usage(uuid, uuid, uuid, text, text, text, uuid, boolean, text, jsonb) to service_role;

revoke execute on function public.rpc_validate_api_key(text) from public, anon, authenticated;
grant execute on function public.rpc_validate_api_key(text) to service_role;

revoke execute on function public.mfa_enforcement_status() from public, anon, authenticated;
grant execute on function public.mfa_enforcement_status() to service_role;

revoke execute on function public.decrypt_slack_token(text, text) from public, anon, authenticated;
grant execute on function public.decrypt_slack_token(text, text) to service_role;

revoke execute on function public.encrypt_slack_token(text, text) from public, anon, authenticated;
grant execute on function public.encrypt_slack_token(text, text) to service_role;

revoke execute on function public.decrypt_system_secret(text, text) from public, anon, authenticated;
grant execute on function public.decrypt_system_secret(text, text) to service_role;

revoke execute on function public.encrypt_system_secret(text, text) from public, anon, authenticated;
grant execute on function public.encrypt_system_secret(text, text) to service_role;

revoke execute on function public.process_scheduling_expirations() from public, anon, authenticated;
grant execute on function public.process_scheduling_expirations() to service_role;

revoke execute on function public.process_scheduling_reminders() from public, anon, authenticated;
grant execute on function public.process_scheduling_reminders() to service_role;

-- 確認: 実行権が service_role だけになっている（別の付与者から付いた実行権が残っていれば止める）
do $$
declare
  v_bad text;
begin
  select string_agg(e.fn, ', ' order by e.fn)
    into v_bad
    from (values
      ('public._create_task_notification(uuid,uuid,uuid,text,text,jsonb)'),
      ('public.decrypt_slack_token(text,text)'),
      ('public.decrypt_system_secret(text,text)'),
      ('public.encrypt_slack_token(text,text)'),
      ('public.encrypt_system_secret(text,text)'),
      ('public.mcp_authorize(uuid,uuid,uuid,text,text,uuid)'),
      ('public.mcp_confirm_delete(uuid,text)'),
      ('public.mcp_dry_run_delete(uuid,uuid,text,uuid[])'),
      ('public.mcp_log_usage(uuid,uuid,uuid,text,text,text,uuid,boolean,text,jsonb)'),
      ('public.mfa_enforcement_status()'),
      ('public.process_scheduling_expirations()'),
      ('public.process_scheduling_reminders()'),
      ('public.rpc_validate_api_key(text)')
    ) as e(fn)
   where has_function_privilege('public', e.fn, 'execute')
      or has_function_privilege('anon', e.fn, 'execute')
      or has_function_privilege('authenticated', e.fn, 'execute')
      or not has_function_privilege('service_role', e.fn, 'execute');

  if v_bad is not null then
    raise exception 'rpc definer authz: 次の関数の実行権が service_role だけになっていません: %', v_bad;
  end if;
end $$;

-- ロールバック（節 A。実行権は、適用前に控えた proacl と違えばそれに合わせる）:
--   grant execute on function public.mcp_dry_run_delete(uuid, uuid, text, uuid[]) to anon, authenticated;
--   grant execute on function public.mcp_confirm_delete(uuid, text) to anon, authenticated;
--   grant execute on function public._create_task_notification(uuid, uuid, uuid, text, text, jsonb) to public, anon, authenticated;
--   grant execute on function public.mcp_authorize(uuid, uuid, uuid, text, text, uuid) to anon, authenticated;
--   grant execute on function public.mcp_log_usage(uuid, uuid, uuid, text, text, text, uuid, boolean, text, jsonb) to anon, authenticated;
--   grant execute on function public.rpc_validate_api_key(text) to public, anon, authenticated;
--   grant execute on function public.mfa_enforcement_status() to anon, authenticated;
--   grant execute on function public.decrypt_slack_token(text, text) to public, anon, authenticated;
--   grant execute on function public.encrypt_slack_token(text, text) to public, anon, authenticated;
--   grant execute on function public.decrypt_system_secret(text, text) to public, anon, authenticated;
--   grant execute on function public.encrypt_system_secret(text, text) to public, anon, authenticated;
--   grant execute on function public.process_scheduling_expirations() to public, anon, authenticated;
--   grant execute on function public.process_scheduling_reminders() to public, anon, authenticated;
-- =============================================================================
-- 節 B: rpc_create_space_with_preset … 組織の社内メンバー（org の役割が owner / admin / member）だけが作れる
--   土台: 20260705222754_fix_preset_rpc_milestones_columns.sql（migrations にある最新の定義）。
--   本文は土台をそのまま写し、「2. Org membership check」の org_memberships の確認に
--   AND role IN ('owner', 'admin', 'member') の1行を足しただけ（社内の役割は app_is_org_internal と同じ）。
--   呼び出し元は src/app/api/spaces/create-with-preset/route.ts（ログイン中の本人のセッションで呼ぶ）。
--   実行権は authenticated と service_role だけ（public / anon は持たない）。
-- =============================================================================

-- 確認: 今の定義が土台（または本 migration の定義）と1文字でも違えば止める
--   （本番だけにある手直しを上書きしないため。止まったら pg_get_functiondef と土台のファイルを見比べる）
do $$
declare
  v_bad text;
begin
  select string_agg(e.fn, ', ' order by e.fn)
    into v_bad
    from (values
      ('rpc_create_space_with_preset(uuid,text,text,jsonb,jsonb,boolean)', '31fd307ea5882931c1bd0c2d6998cd0a', 'f05cd2295a5d1aba1e5ff04eae7d3ac3')
    ) as e(fn, base_md5, new_md5)
    left join pg_proc p on p.oid = to_regprocedure('public.' || e.fn)
   where p.oid is null
      or md5(p.prosrc) not in (e.base_md5, e.new_md5)
      or not p.prosecdef
      or p.proconfig is distinct from array['search_path=public'];

  if v_bad is not null then
    raise exception 'rpc definer authz: 次の関数の今の定義が、土台にした migration の定義と違います: %', v_bad;
  end if;
end $$;

CREATE OR REPLACE FUNCTION public.rpc_create_space_with_preset(
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
      AND role IN ('owner', 'admin', 'member')
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

revoke execute on function public.rpc_create_space_with_preset(uuid, text, text, jsonb, jsonb, boolean) from public, anon;
grant execute on function public.rpc_create_space_with_preset(uuid, text, text, jsonb, jsonb, boolean) to authenticated, service_role;

-- 確認: 実行権が authenticated と service_role だけになっている（別の付与者から付いた実行権が残っていれば止める）
do $$
declare
  v_fn constant text := 'public.rpc_create_space_with_preset(uuid,text,text,jsonb,jsonb,boolean)';
begin
  if has_function_privilege('public', v_fn, 'execute')
     or has_function_privilege('anon', v_fn, 'execute')
     or not has_function_privilege('authenticated', v_fn, 'execute')
     or not has_function_privilege('service_role', v_fn, 'execute') then
    raise exception 'rpc definer authz: % の実行権が authenticated と service_role だけになっていません', v_fn;
  end if;
end $$;

-- ロールバック（節 B。実行権は、適用前に控えた proacl と違えばそれに合わせる）:
--   -- 今の定義を読み、足した1行を外して作り直す（土台の本文に戻る）
--   do $$
--   begin
--     execute replace(
--       pg_get_functiondef('public.rpc_create_space_with_preset(uuid,text,text,jsonb,jsonb,boolean)'::regprocedure),
--       E'\n      AND role IN (''owner'', ''admin'', ''member'')', '');
--   end $$;
--   grant execute on function public.rpc_create_space_with_preset(uuid, text, text, jsonb, jsonb, boolean) to public, anon;
-- =============================================================================
-- 節 C: 次の関数はログイン中の画面（本人のセッション）からだけ呼ぶ。
--   Supabase は関数を作ると anon にも実行権を付けるため、名指しで外し、authenticated と service_role にだけ付け直す。
--   本文は変えない。
--   rpc_should_show_owner_field … 呼び出し元は src/lib/hooks/useSpaceSettings.ts
-- =============================================================================

revoke execute on function public.rpc_should_show_owner_field(uuid) from public, anon;
grant execute on function public.rpc_should_show_owner_field(uuid) to authenticated, service_role;

-- 確認: 実行権が authenticated と service_role だけになっている（別の付与者から付いた実行権が残っていれば止める）
do $$
declare
  v_bad text;
begin
  select string_agg(e.fn, ', ' order by e.fn)
    into v_bad
    from (values
      ('public.rpc_should_show_owner_field(uuid)')
    ) as e(fn)
   where has_function_privilege('public', e.fn, 'execute')
      or has_function_privilege('anon', e.fn, 'execute')
      or not has_function_privilege('authenticated', e.fn, 'execute')
      or not has_function_privilege('service_role', e.fn, 'execute');

  if v_bad is not null then
    raise exception 'rpc definer authz: 次の関数の実行権が authenticated と service_role だけになっていません: %', v_bad;
  end if;
end $$;

-- ロールバック（節 C。実行権は、適用前に控えた proacl と違えばそれに合わせる）:
--   grant execute on function public.rpc_should_show_owner_field(uuid) to anon;
-- =============================================================================
-- 検証:
--   0) ローカル: bash supabase/tests/run_rpc_definer_authz.sh（全 PASS）。
--      RED=1 を付けると本 migration 抜きで流し、変わるはずの assert（chg_*）が全て落ちることを確かめられる。
--   1) 適用前（本番）: 戻すときのために今の権限を控え、節 B の土台を確かめる:
--        select oid::regprocedure, proacl from pg_proc
--         where pronamespace = 'public'::regnamespace and proname in (<下の 15 本>) order by 1;
--        select md5(prosrc) from pg_proc
--         where oid = 'public.rpc_create_space_with_preset(uuid,text,text,jsonb,jsonb,boolean)'::regprocedure;
--          → 31fd307ea5882931c1bd0c2d6998cd0a
--   2) 適用後（本番）:
--        select p.oid::regprocedure,
--               has_function_privilege('anon', p.oid, 'execute') as anon,
--               has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
--               has_function_privilege('service_role', p.oid, 'execute') as service_role
--          from pg_proc p
--         where p.pronamespace = 'public'::regnamespace and p.proname in (<下の 15 本>) order by 1;
--          → 節 A の 13 本は f f t。rpc_create_space_with_preset と rpc_should_show_owner_field は f t t
--      15 本: 'mcp_dry_run_delete', 'mcp_confirm_delete', '_create_task_notification', 'mcp_authorize', 'mcp_log_usage',
--             'rpc_validate_api_key', 'mfa_enforcement_status', 'decrypt_slack_token', 'encrypt_slack_token',
--             'decrypt_system_secret', 'encrypt_system_secret', 'process_scheduling_expirations',
--             'process_scheduling_reminders', 'rpc_create_space_with_preset', 'rpc_should_show_owner_field'
--   3) 画面・処理: 社内メンバーがテンプレートつきでプロジェクトを作れる／プロジェクト設定の担当者欄が出る／
--      MCP・CLI の鍵での操作（削除の dry run → confirm を含む）／Slack 連携・ツール連携の保存と読み出し／
--      ボール渡し・レビューでの通知／マスター管理画面（二要素認証の確認）／日程調整の定期処理（cron の実行履歴）。
-- =============================================================================
