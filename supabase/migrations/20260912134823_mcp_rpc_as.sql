-- =============================================================================
-- 「誰がやったか」を受け取る形の RPC（ボールを渡す・会議の開始 / 終了・レビューの依頼 / 承認 / 差し戻し・日程の確定）
-- 確定設計: Fable 裁定 2026-09-12（CLI/MCP の範囲の照合）
--
-- 規則:
--   7本（rpc_pass_ball・rpc_meeting_start・rpc_meeting_end・rpc_review_open・rpc_review_approve・rpc_review_block・
--   rpc_confirm_proposal_slot）の本体を _xxx_impl(p_actor, …) に移す。本体の確かめ（その space で書き込める役割か・
--   承認者本人か・提案を作った人か・参加者か等）はすべて p_actor に対して行い、「誰がやったか」の記録も p_actor。
--     rpc_xxx(…)             … 画面から呼ぶ。p_actor = auth.uid()。引数・戻り値・実行権は今までどおり
--     rpc_xxx_as(p_actor, …) … サーバー（service_role）だけが呼べる。CLI/MCP の道具が鍵の持ち主を渡す
--     _xxx_impl(p_actor, …)  … 外からは呼べない（実行権なし）
--   書き込める役割の確かめ app_can_write_space(space, org) は呼んだ人（auth.uid()）で判定するので、同じ判定を
--   p_actor で行う _actor_can_write_space(p_actor, space, org) を足す（外からは呼べない）。
--   関数はすべて SECURITY DEFINER・search_path = public。
--   個人の space のタスクは持ち主本人のセッションでしか書けない決まり（トリガーが auth.uid() を見る）は変えない。
--   rpc_xxx_as から個人の space のタスクは書き換えられない。
-- 前提: 節 0 で7本の今の本文と、判定のもとの3関数（app_can_write_space・app_is_org_internal・
--   app_space_role_of_caller）の本文を確かめる。違えば止める（もとの判定が変わったら _actor_can_write_space も合わせる）。
-- ロック: 表は変えない（関数の置き換えだけ）。待つのは 3 秒まで。
-- 冪等: create or replace・実行権は同じ形に置き直す。2回流しても同じ。
-- 可逆: 各節の末尾のロールバック節（後ろの節から順に流す）。行の中身は変えない。
-- =============================================================================


-- =============================================================================
-- 節 0: 変える物の土台の確認（何も変えない）
-- =============================================================================

-- 7本（画面から呼ぶ関数）が土台か本 migration の本文で、判定のもとの3関数が土台の本文であること。違えば止める
do $$
declare
  v_bad text := '';
  v_md5 text;
  r     record;
begin
  set local lock_timeout = '3s';

  for r in select * from (values
      ('public.rpc_pass_ball(uuid,text,uuid[],uuid[],text,uuid)', '977bcc108b1d6f581ca9a16b4dff00ea', '06cd6c42ffe69843b61fabed11494726'),
      ('public.rpc_meeting_start(uuid)', 'fe8ea5ed53f1bdcf7685e1277d9a59f2', 'f5663e8fa4d43ad2ef9352c8174c9275'),
      ('public.rpc_meeting_end(uuid)', 'e21e06bd815e35995bc47180aac20789', '2c26a570ace49280c8123a11781278c3'),
      ('public.rpc_review_open(uuid,uuid[],uuid)', 'c0ccf2b41ad8074713b34e572a575783', '60a60bc69073f6b8e9bef94a6f82b179'),
      ('public.rpc_review_approve(uuid,uuid)', 'e9518cd1eaa8a8a6d15ae73612a32352', '59b48f243f06dd5bac4b9aacc27d3cb2'),
      ('public.rpc_review_block(uuid,text,uuid)', '3465dc3fdaafd35270079e7334deb886', '4d122a228074415d07f8e750e268195f'),
      ('public.rpc_confirm_proposal_slot(uuid,uuid)', 'fe23a2ba7b510dde48f9d64b325af4c2', '916083eb4db06a46ddd79f03bfa4ad01'),
      ('public.app_can_write_space(uuid,uuid)', 'bb8607d0b018630ec8554b22294debbf', 'bb8607d0b018630ec8554b22294debbf'),
      ('public.app_is_org_internal(uuid)', 'dc91b39415b642923820f774badd6d4d', 'dc91b39415b642923820f774badd6d4d'),
      ('public.app_space_role_of_caller(uuid)', '54ee42dc069cf97c306886b53d754d59', '54ee42dc069cf97c306886b53d754d59')
    ) v(sig, base_md5, new_md5)
  loop
    select md5(p.prosrc) into v_md5
      from pg_proc p
     where p.oid = to_regprocedure(r.sig)
       and p.prosecdef
       and p.proconfig = array['search_path=public'];
    if v_md5 is null or v_md5 not in (r.base_md5, r.new_md5) then
      v_bad := v_bad || format(' %s（md5=%s）;', r.sig, coalesce(v_md5, 'なし'));
    end if;
  end loop;

  if v_bad <> '' then
    raise exception 'mcp rpc as: 想定と違います:%', v_bad;
  end if;
end $$;

-- ロールバック（節 0）: なし（確かめるだけで、何も変えない）
-- =============================================================================
-- 節 1: _actor_can_write_space(p_actor, p_space, p_org) … app_can_write_space と同じ判定を p_actor で
--   土台: app_can_write_space・app_is_org_internal・app_space_role_of_caller（節 0 で本文を確かめ済み）
-- =============================================================================

create or replace function public._actor_can_write_space(p_actor uuid, p_space uuid, p_org uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  -- app_can_write_space(p_space, p_org) と同じ判定を、呼んだ人（auth.uid()）ではなく p_actor で行う:
  --   space がその組織のもの・p_actor が組織の社内（owner / admin / member）・
  --   その space の役割が admin / editor（役割が無ければ editor 扱い）
  select exists (select 1 from public.spaces s where s.id = p_space and s.org_id = p_org)
     and exists (select 1 from public.org_memberships m
                  where m.org_id = p_org and m.user_id = p_actor and m.role in ('owner', 'admin', 'member'))
     and coalesce((select sm.role from public.space_memberships sm
                    where sm.space_id = p_space and sm.user_id = p_actor), 'editor') in ('admin', 'editor');
$$;

revoke execute on function public._actor_can_write_space(uuid, uuid, uuid) from public, anon, authenticated, service_role;

-- ロールバック（節 1。後ろの節を戻したあとに流す）:
--   drop function if exists public._actor_can_write_space(uuid, uuid, uuid);
-- =============================================================================
-- 節 2: rpc_pass_ball … 本体は _pass_ball_impl(p_actor, …)。画面の rpc_pass_ball は auth.uid() を、道具の rpc_pass_ball_as は p_actor を渡す
--   本体は 20260911143112_space_role_boundary.sql の本文のまま。変えるのは、呼んだ人を p_actor から取る所と、
--   書き込める役割の確かめを _actor_can_write_space(v_actor_id, …) で行う所の2つだけ。
-- =============================================================================

create or replace function public._pass_ball_impl(
  p_actor uuid,
  p_task_id uuid,
  p_ball text,
  p_client_owner_ids uuid[],
  p_internal_owner_ids uuid[],
  p_reason text,
  p_meeting_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  v_task tasks%ROWTYPE;
  v_actor_id uuid;
  v_org_id uuid;
  v_space_id uuid;
  v_actor_name text;
  v_recipient_ids uuid[];
  v_recipient uuid;
BEGIN
  -- Get current user
  v_actor_id := p_actor;
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Get task info
  SELECT * INTO v_task FROM tasks WHERE id = p_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found: %', p_task_id;
  END IF;

  -- 認可ガード（監査B2 / 越境IDOR対策）: 呼出元が対象 task の space/org に
  -- 書き込める役割（社内の admin / editor）か検証する。ミューテーション前に実行し、越境操作を弾く。
  IF NOT public._actor_can_write_space(v_actor_id, v_task.space_id, v_task.org_id) THEN
    RAISE EXCEPTION 'Not authorized to access this task';
  END IF;

  v_org_id := v_task.org_id;
  v_space_id := v_task.space_id;

  -- Validate: ball='client' requires at least one client owner
  IF p_ball = 'client' AND array_length(p_client_owner_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Client owner required when ball=client';
  END IF;

  -- 不変条件: ball='client' へ渡す＝クライアントに見せる意思とみなし、
  -- client_scope が 'deliverable' でなければ同一UPDATEで揃える（エラーにしない）。
  UPDATE tasks
  SET
    ball = p_ball,
    client_scope = CASE
      WHEN p_ball = 'client' AND client_scope IS DISTINCT FROM 'deliverable'
        THEN 'deliverable'
      ELSE client_scope
    END,
    updated_at = now()
  WHERE id = p_task_id;

  -- Delete existing owners and insert new ones
  DELETE FROM task_owners WHERE task_id = p_task_id;

  -- Insert client owners
  IF array_length(p_client_owner_ids, 1) > 0 THEN
    INSERT INTO task_owners (org_id, space_id, task_id, side, user_id)
    SELECT v_org_id, v_space_id, p_task_id, 'client', unnest(p_client_owner_ids);
  END IF;

  -- Insert internal owners
  IF array_length(p_internal_owner_ids, 1) > 0 THEN
    INSERT INTO task_owners (org_id, space_id, task_id, side, user_id)
    SELECT v_org_id, v_space_id, p_task_id, 'internal', unnest(p_internal_owner_ids);
  END IF;

  -- Create audit log
  INSERT INTO task_events (org_id, space_id, task_id, actor_id, meeting_id, action, payload)
  VALUES (
    v_org_id,
    v_space_id,
    p_task_id,
    v_actor_id,
    p_meeting_id,
    'PASS_BALL',
    jsonb_build_object(
      'ball', p_ball,
      'clientOwnerIds', p_client_owner_ids,
      'internalOwnerIds', p_internal_owner_ids,
      'reason', p_reason
    )
  );

  -- Notify the owners on the receiving side (the side that must now act).
  -- This is what closes the "confirm / act next" loop for internal↔internal too.
  v_recipient_ids := CASE WHEN p_ball = 'client' THEN p_client_owner_ids ELSE p_internal_owner_ids END;
  SELECT display_name INTO v_actor_name FROM profiles WHERE id = v_actor_id;

  IF array_length(v_recipient_ids, 1) > 0 THEN
    FOREACH v_recipient IN ARRAY v_recipient_ids LOOP
      IF v_recipient <> v_actor_id THEN
        PERFORM _create_task_notification(
          v_org_id,
          v_space_id,
          v_recipient,
          'ball_passed',
          format('ball_passed:%s:%s', p_task_id, v_recipient),
          jsonb_build_object(
            'task_id', p_task_id,
            'task_title', v_task.title,
            'title', format('「%s」があなたの番です', v_task.title),
            'message', COALESCE(p_reason, 'ボールがあなたに渡されました。対応を開始してください。'),
            'from_user_name', v_actor_name,
            'ball', p_ball
          )
        );
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

revoke execute on function public._pass_ball_impl(uuid, uuid, text, uuid[], uuid[], text, uuid) from public, anon, authenticated, service_role;

create or replace function public.rpc_pass_ball_as(
  p_actor uuid,
  p_task_id uuid,
  p_ball text,
  p_client_owner_ids uuid[] default '{}',
  p_internal_owner_ids uuid[] default '{}',
  p_reason text default null,
  p_meeting_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public._pass_ball_impl(p_actor, p_task_id, p_ball, p_client_owner_ids, p_internal_owner_ids, p_reason, p_meeting_id);
end;
$$;

revoke execute on function public.rpc_pass_ball_as(uuid, uuid, text, uuid[], uuid[], text, uuid) from public, anon, authenticated;
grant execute on function public.rpc_pass_ball_as(uuid, uuid, text, uuid[], uuid[], text, uuid) to service_role;

create or replace function public.rpc_pass_ball(
  p_task_id uuid,
  p_ball text,
  p_client_owner_ids uuid[] default '{}',
  p_internal_owner_ids uuid[] default '{}',
  p_reason text default null,
  p_meeting_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public._pass_ball_impl(auth.uid(), p_task_id, p_ball, p_client_owner_ids, p_internal_owner_ids, p_reason, p_meeting_id);
end;
$$;

revoke execute on function public.rpc_pass_ball(uuid, text, uuid[], uuid[], text, uuid) from public, anon;
grant execute on function public.rpc_pass_ball(uuid, text, uuid[], uuid[], text, uuid) to authenticated, service_role;

-- ロールバック（節 2。画面の関数を土台の本文に戻し、道具用と本体を外す。実行権は今と同じ）:
--   CREATE OR REPLACE FUNCTION rpc_pass_ball(
--     p_task_id uuid,
--     p_ball text,
--     p_client_owner_ids uuid[] DEFAULT '{}',
--     p_internal_owner_ids uuid[] DEFAULT '{}',
--     p_reason text DEFAULT NULL,
--     p_meeting_id uuid DEFAULT NULL
--   )
--   RETURNS jsonb
--   LANGUAGE plpgsql
--   SECURITY DEFINER
--   SET search_path = public
--   AS $$
--   DECLARE
--     v_task tasks%ROWTYPE;
--     v_actor_id uuid;
--     v_org_id uuid;
--     v_space_id uuid;
--     v_actor_name text;
--     v_recipient_ids uuid[];
--     v_recipient uuid;
--   BEGIN
--     -- Get current user
--     v_actor_id := auth.uid();
--     IF v_actor_id IS NULL THEN
--       RAISE EXCEPTION 'Authentication required';
--     END IF;
--   
--     -- Get task info
--     SELECT * INTO v_task FROM tasks WHERE id = p_task_id;
--     IF NOT FOUND THEN
--       RAISE EXCEPTION 'Task not found: %', p_task_id;
--     END IF;
--   
--     -- 認可ガード（監査B2 / 越境IDOR対策）: 呼出元が対象 task の space/org に
--     -- 書き込める役割（社内の admin / editor）か検証する。ミューテーション前に実行し、越境操作を弾く。
--     IF NOT public.app_can_write_space(v_task.space_id, v_task.org_id) THEN
--       RAISE EXCEPTION 'Not authorized to access this task';
--     END IF;
--   
--     v_org_id := v_task.org_id;
--     v_space_id := v_task.space_id;
--   
--     -- Validate: ball='client' requires at least one client owner
--     IF p_ball = 'client' AND array_length(p_client_owner_ids, 1) IS NULL THEN
--       RAISE EXCEPTION 'Client owner required when ball=client';
--     END IF;
--   
--     -- 不変条件: ball='client' へ渡す＝クライアントに見せる意思とみなし、
--     -- client_scope が 'deliverable' でなければ同一UPDATEで揃える（エラーにしない）。
--     UPDATE tasks
--     SET
--       ball = p_ball,
--       client_scope = CASE
--         WHEN p_ball = 'client' AND client_scope IS DISTINCT FROM 'deliverable'
--           THEN 'deliverable'
--         ELSE client_scope
--       END,
--       updated_at = now()
--     WHERE id = p_task_id;
--   
--     -- Delete existing owners and insert new ones
--     DELETE FROM task_owners WHERE task_id = p_task_id;
--   
--     -- Insert client owners
--     IF array_length(p_client_owner_ids, 1) > 0 THEN
--       INSERT INTO task_owners (org_id, space_id, task_id, side, user_id)
--       SELECT v_org_id, v_space_id, p_task_id, 'client', unnest(p_client_owner_ids);
--     END IF;
--   
--     -- Insert internal owners
--     IF array_length(p_internal_owner_ids, 1) > 0 THEN
--       INSERT INTO task_owners (org_id, space_id, task_id, side, user_id)
--       SELECT v_org_id, v_space_id, p_task_id, 'internal', unnest(p_internal_owner_ids);
--     END IF;
--   
--     -- Create audit log
--     INSERT INTO task_events (org_id, space_id, task_id, actor_id, meeting_id, action, payload)
--     VALUES (
--       v_org_id,
--       v_space_id,
--       p_task_id,
--       v_actor_id,
--       p_meeting_id,
--       'PASS_BALL',
--       jsonb_build_object(
--         'ball', p_ball,
--         'clientOwnerIds', p_client_owner_ids,
--         'internalOwnerIds', p_internal_owner_ids,
--         'reason', p_reason
--       )
--     );
--   
--     -- Notify the owners on the receiving side (the side that must now act).
--     -- This is what closes the "confirm / act next" loop for internal↔internal too.
--     v_recipient_ids := CASE WHEN p_ball = 'client' THEN p_client_owner_ids ELSE p_internal_owner_ids END;
--     SELECT display_name INTO v_actor_name FROM profiles WHERE id = v_actor_id;
--   
--     IF array_length(v_recipient_ids, 1) > 0 THEN
--       FOREACH v_recipient IN ARRAY v_recipient_ids LOOP
--         IF v_recipient <> v_actor_id THEN
--           PERFORM _create_task_notification(
--             v_org_id,
--             v_space_id,
--             v_recipient,
--             'ball_passed',
--             format('ball_passed:%s:%s', p_task_id, v_recipient),
--             jsonb_build_object(
--               'task_id', p_task_id,
--               'task_title', v_task.title,
--               'title', format('「%s」があなたの番です', v_task.title),
--               'message', COALESCE(p_reason, 'ボールがあなたに渡されました。対応を開始してください。'),
--               'from_user_name', v_actor_name,
--               'ball', p_ball
--             )
--           );
--         END IF;
--       END LOOP;
--     END IF;
--   
--     RETURN jsonb_build_object('ok', true);
--   END;
--   $$;
--   drop function if exists public.rpc_pass_ball_as(uuid, uuid, text, uuid[], uuid[], text, uuid);
--   drop function if exists public._pass_ball_impl(uuid, uuid, text, uuid[], uuid[], text, uuid);
-- =============================================================================
-- 節 3: rpc_meeting_start … 本体は _meeting_start_impl(p_actor, …)。画面の rpc_meeting_start は auth.uid() を、道具の rpc_meeting_start_as は p_actor を渡す
--   本体は 20260911143112_space_role_boundary.sql の本文のまま。変えるのは、呼んだ人を p_actor から取る所と、
--   書き込める役割の確かめを _actor_can_write_space(v_actor_id, …) で行う所の2つだけ。
-- =============================================================================

create or replace function public._meeting_start_impl(
  p_actor uuid,
  p_meeting_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  v_meeting meetings%ROWTYPE;
  v_actor_id uuid;
BEGIN
  v_actor_id := p_actor;
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Get meeting
  SELECT * INTO v_meeting FROM meetings WHERE id = p_meeting_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Meeting not found: %', p_meeting_id;
  END IF;

  -- 認可ガード（監査B2 / 越境IDOR対策）: 呼出元が対象 meeting の space/org に
  -- 書き込める役割（社内の admin / editor）か検証する。ミューテーション前に実行し、越境操作を弾く。
  IF NOT public._actor_can_write_space(v_actor_id, v_meeting.space_id, v_meeting.org_id) THEN
    RAISE EXCEPTION 'Not authorized to access this meeting';
  END IF;

  -- Validate status
  IF v_meeting.status != 'planned' THEN
    RAISE EXCEPTION 'Meeting can only start from planned status, current: %', v_meeting.status;
  END IF;

  -- Update meeting
  UPDATE meetings
  SET status = 'in_progress', started_at = now(), updated_at = now()
  WHERE id = p_meeting_id;

  -- Create audit log (uses a dummy task event for meeting-level events)
  -- Note: In production, consider a separate meeting_events table
  INSERT INTO task_events (org_id, space_id, task_id, actor_id, meeting_id, action, payload)
  SELECT
    v_meeting.org_id,
    v_meeting.space_id,
    (SELECT id FROM tasks WHERE space_id = v_meeting.space_id LIMIT 1), -- dummy task
    v_actor_id,
    p_meeting_id,
    'MEETING_START',
    jsonb_build_object('meetingTitle', v_meeting.title)
  WHERE EXISTS (SELECT 1 FROM tasks WHERE space_id = v_meeting.space_id);

  RETURN jsonb_build_object('ok', true);
END;
$$;

revoke execute on function public._meeting_start_impl(uuid, uuid) from public, anon, authenticated, service_role;

create or replace function public.rpc_meeting_start_as(
  p_actor uuid,
  p_meeting_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public._meeting_start_impl(p_actor, p_meeting_id);
end;
$$;

revoke execute on function public.rpc_meeting_start_as(uuid, uuid) from public, anon, authenticated;
grant execute on function public.rpc_meeting_start_as(uuid, uuid) to service_role;

create or replace function public.rpc_meeting_start(
  p_meeting_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public._meeting_start_impl(auth.uid(), p_meeting_id);
end;
$$;

revoke execute on function public.rpc_meeting_start(uuid) from public, anon;
grant execute on function public.rpc_meeting_start(uuid) to authenticated, service_role;

-- ロールバック（節 3。画面の関数を土台の本文に戻し、道具用と本体を外す。実行権は今と同じ）:
--   CREATE OR REPLACE FUNCTION rpc_meeting_start(
--     p_meeting_id uuid
--   )
--   RETURNS jsonb
--   LANGUAGE plpgsql
--   SECURITY DEFINER
--   SET search_path = public
--   AS $$
--   DECLARE
--     v_meeting meetings%ROWTYPE;
--     v_actor_id uuid;
--   BEGIN
--     v_actor_id := auth.uid();
--     IF v_actor_id IS NULL THEN
--       RAISE EXCEPTION 'Authentication required';
--     END IF;
--   
--     -- Get meeting
--     SELECT * INTO v_meeting FROM meetings WHERE id = p_meeting_id;
--     IF NOT FOUND THEN
--       RAISE EXCEPTION 'Meeting not found: %', p_meeting_id;
--     END IF;
--   
--     -- 認可ガード（監査B2 / 越境IDOR対策）: 呼出元が対象 meeting の space/org に
--     -- 書き込める役割（社内の admin / editor）か検証する。ミューテーション前に実行し、越境操作を弾く。
--     IF NOT public.app_can_write_space(v_meeting.space_id, v_meeting.org_id) THEN
--       RAISE EXCEPTION 'Not authorized to access this meeting';
--     END IF;
--   
--     -- Validate status
--     IF v_meeting.status != 'planned' THEN
--       RAISE EXCEPTION 'Meeting can only start from planned status, current: %', v_meeting.status;
--     END IF;
--   
--     -- Update meeting
--     UPDATE meetings
--     SET status = 'in_progress', started_at = now(), updated_at = now()
--     WHERE id = p_meeting_id;
--   
--     -- Create audit log (uses a dummy task event for meeting-level events)
--     -- Note: In production, consider a separate meeting_events table
--     INSERT INTO task_events (org_id, space_id, task_id, actor_id, meeting_id, action, payload)
--     SELECT
--       v_meeting.org_id,
--       v_meeting.space_id,
--       (SELECT id FROM tasks WHERE space_id = v_meeting.space_id LIMIT 1), -- dummy task
--       v_actor_id,
--       p_meeting_id,
--       'MEETING_START',
--       jsonb_build_object('meetingTitle', v_meeting.title)
--     WHERE EXISTS (SELECT 1 FROM tasks WHERE space_id = v_meeting.space_id);
--   
--     RETURN jsonb_build_object('ok', true);
--   END;
--   $$;
--   drop function if exists public.rpc_meeting_start_as(uuid, uuid);
--   drop function if exists public._meeting_start_impl(uuid, uuid);
-- =============================================================================
-- 節 4: rpc_meeting_end … 本体は _meeting_end_impl(p_actor, …)。画面の rpc_meeting_end は auth.uid() を、道具の rpc_meeting_end_as は p_actor を渡す
--   本体は 20260911143112_space_role_boundary.sql の本文のまま。変えるのは、呼んだ人を p_actor から取る所と、
--   書き込める役割の確かめを _actor_can_write_space(v_actor_id, …) で行う所の2つだけ。
-- =============================================================================

create or replace function public._meeting_end_impl(
  p_actor uuid,
  p_meeting_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  v_meeting meetings%ROWTYPE;
  v_actor_id uuid;
  v_decided_count int;
  v_open_count int;
  v_ball_client_count int;
  v_summary_subject text;
  v_summary_body text;
  v_dedupe_key text;
  v_participant record;
  v_task_list text;
  v_updated boolean;
BEGIN
  v_actor_id := p_actor;
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Get meeting with lock to prevent race conditions
  SELECT * INTO v_meeting FROM meetings WHERE id = p_meeting_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Meeting not found: %', p_meeting_id;
  END IF;

  -- Authorization check: user must be a participant or space member
  IF NOT EXISTS (
    SELECT 1 FROM meeting_participants mp
    WHERE mp.meeting_id = p_meeting_id AND mp.user_id = v_actor_id
  ) AND NOT EXISTS (
    SELECT 1 FROM space_memberships sm
    WHERE sm.space_id = v_meeting.space_id AND sm.user_id = v_actor_id
  ) THEN
    RAISE EXCEPTION 'Not authorized to end this meeting';
  END IF;

  -- 書き込める役割（社内の admin / editor）だけが通る
  IF NOT public._actor_can_write_space(v_actor_id, v_meeting.space_id, v_meeting.org_id) THEN
    RAISE EXCEPTION 'Not authorized to end this meeting';
  END IF;

  -- Validate status (allow re-ending for idempotency)
  IF v_meeting.status NOT IN ('in_progress', 'ended') THEN
    RAISE EXCEPTION 'Meeting can only end from in_progress status, current: %', v_meeting.status;
  END IF;

  -- Count stats for this meeting's space
  SELECT COUNT(*) INTO v_decided_count
  FROM task_events te
  WHERE te.meeting_id = p_meeting_id AND te.action IN ('CONSIDERING_DECIDE', 'SPEC_DECIDE');

  SELECT COUNT(*) INTO v_open_count
  FROM tasks t
  WHERE t.space_id = v_meeting.space_id AND t.status = 'considering';

  SELECT COUNT(*) INTO v_ball_client_count
  FROM tasks t
  WHERE t.space_id = v_meeting.space_id AND t.ball = 'client';

  -- AT-004: Generate task list ordered by ball (client first), then due_date (null last)
  -- Use subquery with LIMIT to correctly limit rows before aggregation
  SELECT string_agg(task_line, E'\n') INTO v_task_list
  FROM (
    SELECT format('- %s%s',
      t.title,
      CASE WHEN t.due_date IS NOT NULL
        THEN format(' (期限: %s)', to_char(t.due_date, 'MM/DD'))
        ELSE ''
      END
    ) AS task_line
    FROM tasks t
    WHERE t.space_id = v_meeting.space_id
      AND (t.ball = 'client' OR t.status = 'considering')
    ORDER BY
      CASE WHEN t.ball = 'client' THEN 0 ELSE 1 END,
      CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END,
      t.due_date
    LIMIT 10
  ) sub;

  -- Generate summary
  v_summary_subject := format('【議事録】%s', v_meeting.title);
  v_summary_body := format(
    E'会議「%s」が終了しました。\n\n' ||
    E'決定事項: %s件\n' ||
    E'未決事項: %s件\n' ||
    E'クライアント確認待ち: %s件\n\n' ||
    E'【要対応タスク】\n%s',
    v_meeting.title,
    v_decided_count,
    v_open_count,
    v_ball_client_count,
    COALESCE(v_task_list, '(なし)')
  );

  -- Update meeting (only if not already ended)
  IF v_meeting.status = 'in_progress' THEN
    UPDATE meetings
    SET
      status = 'ended',
      ended_at = now(),
      summary_subject = v_summary_subject,
      summary_body = v_summary_body,
      updated_at = now()
    WHERE id = p_meeting_id;
  END IF;

  -- AT-003: Generate notifications for all participants (idempotent via dedupe_key)
  -- dedupe_key format: meeting_end:{meeting_id}
  v_dedupe_key := format('meeting_end:%s', p_meeting_id);

  -- Insert in_app notifications for all meeting participants
  FOR v_participant IN
    SELECT mp.user_id
    FROM meeting_participants mp
    WHERE mp.meeting_id = p_meeting_id
  LOOP
    INSERT INTO notifications (
      org_id,
      space_id,
      to_user_id,
      channel,
      type,
      dedupe_key,
      payload
    ) VALUES (
      v_meeting.org_id,
      v_meeting.space_id,
      v_participant.user_id,
      'in_app',
      'meeting_ended',
      v_dedupe_key,
      jsonb_build_object(
        'title', v_summary_subject,
        'message', format('決定: %s件 / 未決: %s件 / 要対応: %s件', v_decided_count, v_open_count, v_ball_client_count),
        'meeting_id', p_meeting_id,
        'meeting_title', v_meeting.title,
        'summary_subject', v_summary_subject,
        'summary_body', v_summary_body,
        'decided_count', v_decided_count,
        'open_count', v_open_count,
        'ball_client_count', v_ball_client_count
      )
    )
    ON CONFLICT (to_user_id, channel, dedupe_key) DO NOTHING;
  END LOOP;

  -- Also notify task owners of client-ball tasks who weren't in the meeting
  INSERT INTO notifications (
    org_id,
    space_id,
    to_user_id,
    channel,
    type,
    dedupe_key,
    payload
  )
  SELECT DISTINCT
    v_meeting.org_id,
    v_meeting.space_id,
    tow.user_id,
    'in_app',
    'meeting_ended',
    v_dedupe_key,
    jsonb_build_object(
      'title', v_summary_subject,
      'message', format('決定: %s件 / 未決: %s件 / 要対応: %s件', v_decided_count, v_open_count, v_ball_client_count),
      'meeting_id', p_meeting_id,
      'meeting_title', v_meeting.title,
      'summary_subject', v_summary_subject,
      'summary_body', v_summary_body,
      'decided_count', v_decided_count,
      'open_count', v_open_count,
      'ball_client_count', v_ball_client_count
    )
  FROM task_owners tow
  JOIN tasks t ON t.id = tow.task_id
  WHERE t.space_id = v_meeting.space_id
    AND t.ball = 'client'
    AND NOT EXISTS (
      SELECT 1 FROM meeting_participants mp
      WHERE mp.meeting_id = p_meeting_id AND mp.user_id = tow.user_id
    )
  ON CONFLICT (to_user_id, channel, dedupe_key) DO NOTHING;

  -- Create audit log (only if not already ended)
  IF v_meeting.status = 'in_progress' THEN
    INSERT INTO task_events (org_id, space_id, task_id, actor_id, meeting_id, action, payload)
    SELECT
      v_meeting.org_id,
      v_meeting.space_id,
      (SELECT id FROM tasks WHERE space_id = v_meeting.space_id LIMIT 1),
      v_actor_id,
      p_meeting_id,
      'MEETING_END',
      jsonb_build_object(
        'decidedCount', v_decided_count,
        'openCount', v_open_count,
        'ballClientCount', v_ball_client_count
      )
    WHERE EXISTS (SELECT 1 FROM tasks WHERE space_id = v_meeting.space_id);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'summary_subject', v_summary_subject,
    'summary_body', v_summary_body,
    'counts', jsonb_build_object(
      'decided', v_decided_count,
      'open', v_open_count,
      'ball_client', v_ball_client_count
    )
  );
END;
$$;

revoke execute on function public._meeting_end_impl(uuid, uuid) from public, anon, authenticated, service_role;

create or replace function public.rpc_meeting_end_as(
  p_actor uuid,
  p_meeting_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public._meeting_end_impl(p_actor, p_meeting_id);
end;
$$;

revoke execute on function public.rpc_meeting_end_as(uuid, uuid) from public, anon, authenticated;
grant execute on function public.rpc_meeting_end_as(uuid, uuid) to service_role;

create or replace function public.rpc_meeting_end(
  p_meeting_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public._meeting_end_impl(auth.uid(), p_meeting_id);
end;
$$;

revoke execute on function public.rpc_meeting_end(uuid) from public, anon;
grant execute on function public.rpc_meeting_end(uuid) to authenticated, service_role;

-- ロールバック（節 4。画面の関数を土台の本文に戻し、道具用と本体を外す。実行権は今と同じ）:
--   CREATE OR REPLACE FUNCTION rpc_meeting_end(
--     p_meeting_id uuid
--   )
--   RETURNS jsonb
--   LANGUAGE plpgsql
--   SECURITY DEFINER
--   SET search_path = public
--   AS $$
--   DECLARE
--     v_meeting meetings%ROWTYPE;
--     v_actor_id uuid;
--     v_decided_count int;
--     v_open_count int;
--     v_ball_client_count int;
--     v_summary_subject text;
--     v_summary_body text;
--     v_dedupe_key text;
--     v_participant record;
--     v_task_list text;
--     v_updated boolean;
--   BEGIN
--     v_actor_id := auth.uid();
--     IF v_actor_id IS NULL THEN
--       RAISE EXCEPTION 'Authentication required';
--     END IF;
--   
--     -- Get meeting with lock to prevent race conditions
--     SELECT * INTO v_meeting FROM meetings WHERE id = p_meeting_id FOR UPDATE;
--     IF NOT FOUND THEN
--       RAISE EXCEPTION 'Meeting not found: %', p_meeting_id;
--     END IF;
--   
--     -- Authorization check: user must be a participant or space member
--     IF NOT EXISTS (
--       SELECT 1 FROM meeting_participants mp
--       WHERE mp.meeting_id = p_meeting_id AND mp.user_id = v_actor_id
--     ) AND NOT EXISTS (
--       SELECT 1 FROM space_memberships sm
--       WHERE sm.space_id = v_meeting.space_id AND sm.user_id = v_actor_id
--     ) THEN
--       RAISE EXCEPTION 'Not authorized to end this meeting';
--     END IF;
--   
--     -- 書き込める役割（社内の admin / editor）だけが通る
--     IF NOT public.app_can_write_space(v_meeting.space_id, v_meeting.org_id) THEN
--       RAISE EXCEPTION 'Not authorized to end this meeting';
--     END IF;
--   
--     -- Validate status (allow re-ending for idempotency)
--     IF v_meeting.status NOT IN ('in_progress', 'ended') THEN
--       RAISE EXCEPTION 'Meeting can only end from in_progress status, current: %', v_meeting.status;
--     END IF;
--   
--     -- Count stats for this meeting's space
--     SELECT COUNT(*) INTO v_decided_count
--     FROM task_events te
--     WHERE te.meeting_id = p_meeting_id AND te.action IN ('CONSIDERING_DECIDE', 'SPEC_DECIDE');
--   
--     SELECT COUNT(*) INTO v_open_count
--     FROM tasks t
--     WHERE t.space_id = v_meeting.space_id AND t.status = 'considering';
--   
--     SELECT COUNT(*) INTO v_ball_client_count
--     FROM tasks t
--     WHERE t.space_id = v_meeting.space_id AND t.ball = 'client';
--   
--     -- AT-004: Generate task list ordered by ball (client first), then due_date (null last)
--     -- Use subquery with LIMIT to correctly limit rows before aggregation
--     SELECT string_agg(task_line, E'\n') INTO v_task_list
--     FROM (
--       SELECT format('- %s%s',
--         t.title,
--         CASE WHEN t.due_date IS NOT NULL
--           THEN format(' (期限: %s)', to_char(t.due_date, 'MM/DD'))
--           ELSE ''
--         END
--       ) AS task_line
--       FROM tasks t
--       WHERE t.space_id = v_meeting.space_id
--         AND (t.ball = 'client' OR t.status = 'considering')
--       ORDER BY
--         CASE WHEN t.ball = 'client' THEN 0 ELSE 1 END,
--         CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END,
--         t.due_date
--       LIMIT 10
--     ) sub;
--   
--     -- Generate summary
--     v_summary_subject := format('【議事録】%s', v_meeting.title);
--     v_summary_body := format(
--       E'会議「%s」が終了しました。\n\n' ||
--       E'決定事項: %s件\n' ||
--       E'未決事項: %s件\n' ||
--       E'クライアント確認待ち: %s件\n\n' ||
--       E'【要対応タスク】\n%s',
--       v_meeting.title,
--       v_decided_count,
--       v_open_count,
--       v_ball_client_count,
--       COALESCE(v_task_list, '(なし)')
--     );
--   
--     -- Update meeting (only if not already ended)
--     IF v_meeting.status = 'in_progress' THEN
--       UPDATE meetings
--       SET
--         status = 'ended',
--         ended_at = now(),
--         summary_subject = v_summary_subject,
--         summary_body = v_summary_body,
--         updated_at = now()
--       WHERE id = p_meeting_id;
--     END IF;
--   
--     -- AT-003: Generate notifications for all participants (idempotent via dedupe_key)
--     -- dedupe_key format: meeting_end:{meeting_id}
--     v_dedupe_key := format('meeting_end:%s', p_meeting_id);
--   
--     -- Insert in_app notifications for all meeting participants
--     FOR v_participant IN
--       SELECT mp.user_id
--       FROM meeting_participants mp
--       WHERE mp.meeting_id = p_meeting_id
--     LOOP
--       INSERT INTO notifications (
--         org_id,
--         space_id,
--         to_user_id,
--         channel,
--         type,
--         dedupe_key,
--         payload
--       ) VALUES (
--         v_meeting.org_id,
--         v_meeting.space_id,
--         v_participant.user_id,
--         'in_app',
--         'meeting_ended',
--         v_dedupe_key,
--         jsonb_build_object(
--           'title', v_summary_subject,
--           'message', format('決定: %s件 / 未決: %s件 / 要対応: %s件', v_decided_count, v_open_count, v_ball_client_count),
--           'meeting_id', p_meeting_id,
--           'meeting_title', v_meeting.title,
--           'summary_subject', v_summary_subject,
--           'summary_body', v_summary_body,
--           'decided_count', v_decided_count,
--           'open_count', v_open_count,
--           'ball_client_count', v_ball_client_count
--         )
--       )
--       ON CONFLICT (to_user_id, channel, dedupe_key) DO NOTHING;
--     END LOOP;
--   
--     -- Also notify task owners of client-ball tasks who weren't in the meeting
--     INSERT INTO notifications (
--       org_id,
--       space_id,
--       to_user_id,
--       channel,
--       type,
--       dedupe_key,
--       payload
--     )
--     SELECT DISTINCT
--       v_meeting.org_id,
--       v_meeting.space_id,
--       tow.user_id,
--       'in_app',
--       'meeting_ended',
--       v_dedupe_key,
--       jsonb_build_object(
--         'title', v_summary_subject,
--         'message', format('決定: %s件 / 未決: %s件 / 要対応: %s件', v_decided_count, v_open_count, v_ball_client_count),
--         'meeting_id', p_meeting_id,
--         'meeting_title', v_meeting.title,
--         'summary_subject', v_summary_subject,
--         'summary_body', v_summary_body,
--         'decided_count', v_decided_count,
--         'open_count', v_open_count,
--         'ball_client_count', v_ball_client_count
--       )
--     FROM task_owners tow
--     JOIN tasks t ON t.id = tow.task_id
--     WHERE t.space_id = v_meeting.space_id
--       AND t.ball = 'client'
--       AND NOT EXISTS (
--         SELECT 1 FROM meeting_participants mp
--         WHERE mp.meeting_id = p_meeting_id AND mp.user_id = tow.user_id
--       )
--     ON CONFLICT (to_user_id, channel, dedupe_key) DO NOTHING;
--   
--     -- Create audit log (only if not already ended)
--     IF v_meeting.status = 'in_progress' THEN
--       INSERT INTO task_events (org_id, space_id, task_id, actor_id, meeting_id, action, payload)
--       SELECT
--         v_meeting.org_id,
--         v_meeting.space_id,
--         (SELECT id FROM tasks WHERE space_id = v_meeting.space_id LIMIT 1),
--         v_actor_id,
--         p_meeting_id,
--         'MEETING_END',
--         jsonb_build_object(
--           'decidedCount', v_decided_count,
--           'openCount', v_open_count,
--           'ballClientCount', v_ball_client_count
--         )
--       WHERE EXISTS (SELECT 1 FROM tasks WHERE space_id = v_meeting.space_id);
--     END IF;
--   
--     RETURN jsonb_build_object(
--       'ok', true,
--       'summary_subject', v_summary_subject,
--       'summary_body', v_summary_body,
--       'counts', jsonb_build_object(
--         'decided', v_decided_count,
--         'open', v_open_count,
--         'ball_client', v_ball_client_count
--       )
--     );
--   END;
--   $$;
--   drop function if exists public.rpc_meeting_end_as(uuid, uuid);
--   drop function if exists public._meeting_end_impl(uuid, uuid);
-- =============================================================================
-- 節 5: rpc_review_open … 本体は _review_open_impl(p_actor, …)。画面の rpc_review_open は auth.uid() を、道具の rpc_review_open_as は p_actor を渡す
--   本体は 20260911180601_review_request_notify.sql の本文のまま。変えるのは、呼んだ人を p_actor から取る所と、
--   書き込める役割の確かめを _actor_can_write_space(v_actor_id, …) で行う所の2つだけ。
-- =============================================================================

create or replace function public._review_open_impl(
  p_actor uuid,
  p_task_id uuid,
  p_reviewer_ids uuid[],
  p_meeting_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  v_task tasks%ROWTYPE;
  v_actor_id uuid;
  v_review_id uuid;
  v_existing_reviewer_ids uuid[];
  v_has_pending boolean;
  v_final_status text;
  v_actor_name text;
  v_pending_reviewer uuid;
BEGIN
  v_actor_id := p_actor;
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Sanitize reviewer IDs: remove NULLs and deduplicate
  p_reviewer_ids := ARRAY(
    SELECT DISTINCT rid FROM unnest(p_reviewer_ids) AS rid WHERE rid IS NOT NULL
  );

  -- Validate reviewers
  IF array_length(p_reviewer_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'At least one reviewer required';
  END IF;

  -- Get task
  SELECT * INTO v_task FROM tasks WHERE id = p_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found: %', p_task_id;
  END IF;

  -- Security: Verify caller is a member of the task's space (admin or editor)
  IF NOT EXISTS (
    SELECT 1 FROM space_memberships
    WHERE space_id = v_task.space_id
      AND user_id = v_actor_id
      AND role IN ('admin', 'editor')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions: you must be an admin or editor in this space';
  END IF;

  -- 書き込める役割（社内の admin / editor）だけが通る
  IF NOT public._actor_can_write_space(v_actor_id, v_task.space_id, v_task.org_id) THEN
    RAISE EXCEPTION 'Not authorized to access this task';
  END IF;

  -- Security: 社内承認のレビュアーは社内ロール（admin / editor）のみ。
  -- client / vendor ロールのメンバーは指定不可（クライアント確認はボールで行う）。
  IF EXISTS (
    SELECT rid FROM unnest(p_reviewer_ids) AS rid
    WHERE rid NOT IN (
      SELECT user_id FROM space_memberships
      WHERE space_id = v_task.space_id
        AND role IN ('admin', 'editor')
    )
  ) THEN
    RAISE EXCEPTION 'One or more reviewer IDs are not internal members (admin/editor) of this space';
  END IF;

  -- Upsert review (task_id is UNIQUE) — status determined after approval updates
  INSERT INTO reviews (org_id, space_id, task_id, status, created_by)
  VALUES (v_task.org_id, v_task.space_id, p_task_id, 'open', v_actor_id)
  ON CONFLICT (task_id) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_review_id;

  -- Get currently existing reviewer IDs
  SELECT COALESCE(array_agg(reviewer_id), '{}')
  INTO v_existing_reviewer_ids
  FROM review_approvals
  WHERE review_id = v_review_id;

  -- Remove reviewers no longer in the list
  DELETE FROM review_approvals
  WHERE review_id = v_review_id
    AND reviewer_id != ALL(p_reviewer_ids);

  -- Add only NEW reviewers as 'pending' (preserve existing approvals)
  INSERT INTO review_approvals (org_id, review_id, reviewer_id, state)
  SELECT v_task.org_id, v_review_id, rid, 'pending'
  FROM unnest(p_reviewer_ids) AS rid
  WHERE rid != ALL(v_existing_reviewer_ids);

  -- Reset 'blocked' reviewers back to 'pending' on re-review
  -- (approved items are preserved per REVIEW_SPEC)
  UPDATE review_approvals
  SET state = 'pending', blocked_reason = NULL, updated_at = now()
  WHERE review_id = v_review_id AND state = 'blocked';

  -- Re-evaluate review status based on current approval states
  SELECT EXISTS (
    SELECT 1 FROM review_approvals
    WHERE review_id = v_review_id AND state = 'pending'
  ) INTO v_has_pending;

  IF v_has_pending THEN
    v_final_status := 'open';
  ELSE
    v_final_status := 'approved';
  END IF;

  UPDATE reviews SET status = v_final_status, updated_at = now()
  WHERE id = v_review_id;

  -- Create audit log
  INSERT INTO task_events (org_id, space_id, task_id, actor_id, meeting_id, action, payload)
  VALUES (
    v_task.org_id,
    v_task.space_id,
    p_task_id,
    v_actor_id,
    p_meeting_id,
    'REVIEW_OPEN',
    jsonb_build_object('reviewerIds', p_reviewer_ids)
  );

  -- 承認を頼まれた人（いま保留中の承認者全員）の受信トレイにお知らせを作る。新しく加えた人と、差し戻しから
  -- 保留中に戻った人の両方が入る。依頼した本人には作らない（20260703_000_collab_notifications.sql と同じ）。
  -- 同じ依頼のお知らせがすでにあれば、未読・要対応に戻して一番上に出す。前の依頼に返事をしていた人
  -- （差し戻し → もう一度の依頼）には、新しい依頼として即時メールも送り直す（まだ返事をしていない人には送り直さない）。
  -- 前のお知らせを書き直すので、プッシュは出ない（プッシュは新しく作ったときだけ）
  SELECT display_name INTO v_actor_name FROM profiles WHERE id = v_actor_id;

  FOR v_pending_reviewer IN
    SELECT reviewer_id FROM review_approvals
    WHERE review_id = v_review_id AND state = 'pending'
  LOOP
    IF v_pending_reviewer <> v_actor_id THEN
      INSERT INTO notifications (org_id, space_id, to_user_id, channel, type, dedupe_key, payload)
      VALUES (
        v_task.org_id,
        v_task.space_id,
        v_pending_reviewer,
        'in_app',
        'review_request',
        format('review_request:%s:%s', v_review_id, v_pending_reviewer),
        jsonb_build_object(
          'task_id', p_task_id,
          'task_title', v_task.title,
          'title', format('社内承認の依頼: 「%s」', v_task.title),
          'message', '社内承認をお願いします。承認するか、理由を添えて差し戻してください。',
          'from_user_name', v_actor_name
        )
      )
      ON CONFLICT (to_user_id, channel, dedupe_key) DO UPDATE
        SET payload = excluded.payload,
            read_at = NULL,
            actioned_at = NULL,
            immediate_email_sent_at = CASE
              WHEN notifications.actioned_at IS NOT NULL THEN NULL
              ELSE notifications.immediate_email_sent_at
            END,
            created_at = now();
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true);
END;
$$;

revoke execute on function public._review_open_impl(uuid, uuid, uuid[], uuid) from public, anon, authenticated, service_role;

create or replace function public.rpc_review_open_as(
  p_actor uuid,
  p_task_id uuid,
  p_reviewer_ids uuid[],
  p_meeting_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public._review_open_impl(p_actor, p_task_id, p_reviewer_ids, p_meeting_id);
end;
$$;

revoke execute on function public.rpc_review_open_as(uuid, uuid, uuid[], uuid) from public, anon, authenticated;
grant execute on function public.rpc_review_open_as(uuid, uuid, uuid[], uuid) to service_role;

create or replace function public.rpc_review_open(
  p_task_id uuid,
  p_reviewer_ids uuid[],
  p_meeting_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public._review_open_impl(auth.uid(), p_task_id, p_reviewer_ids, p_meeting_id);
end;
$$;

revoke execute on function public.rpc_review_open(uuid, uuid[], uuid) from public, anon;
grant execute on function public.rpc_review_open(uuid, uuid[], uuid) to authenticated, service_role;

-- ロールバック（節 5。画面の関数を土台の本文に戻し、道具用と本体を外す。実行権は今と同じ）:
--   CREATE OR REPLACE FUNCTION rpc_review_open(
--     p_task_id uuid,
--     p_reviewer_ids uuid[],
--     p_meeting_id uuid DEFAULT NULL
--   )
--   RETURNS jsonb
--   LANGUAGE plpgsql
--   SECURITY DEFINER
--   SET search_path = public
--   AS $$
--   DECLARE
--     v_task tasks%ROWTYPE;
--     v_actor_id uuid;
--     v_review_id uuid;
--     v_existing_reviewer_ids uuid[];
--     v_has_pending boolean;
--     v_final_status text;
--     v_actor_name text;
--     v_pending_reviewer uuid;
--   BEGIN
--     v_actor_id := auth.uid();
--     IF v_actor_id IS NULL THEN
--       RAISE EXCEPTION 'Authentication required';
--     END IF;
--   
--     -- Sanitize reviewer IDs: remove NULLs and deduplicate
--     p_reviewer_ids := ARRAY(
--       SELECT DISTINCT rid FROM unnest(p_reviewer_ids) AS rid WHERE rid IS NOT NULL
--     );
--   
--     -- Validate reviewers
--     IF array_length(p_reviewer_ids, 1) IS NULL THEN
--       RAISE EXCEPTION 'At least one reviewer required';
--     END IF;
--   
--     -- Get task
--     SELECT * INTO v_task FROM tasks WHERE id = p_task_id;
--     IF NOT FOUND THEN
--       RAISE EXCEPTION 'Task not found: %', p_task_id;
--     END IF;
--   
--     -- Security: Verify caller is a member of the task's space (admin or editor)
--     IF NOT EXISTS (
--       SELECT 1 FROM space_memberships
--       WHERE space_id = v_task.space_id
--         AND user_id = v_actor_id
--         AND role IN ('admin', 'editor')
--     ) THEN
--       RAISE EXCEPTION 'Insufficient permissions: you must be an admin or editor in this space';
--     END IF;
--   
--     -- 書き込める役割（社内の admin / editor）だけが通る
--     IF NOT public.app_can_write_space(v_task.space_id, v_task.org_id) THEN
--       RAISE EXCEPTION 'Not authorized to access this task';
--     END IF;
--   
--     -- Security: 社内承認のレビュアーは社内ロール（admin / editor）のみ。
--     -- client / vendor ロールのメンバーは指定不可（クライアント確認はボールで行う）。
--     IF EXISTS (
--       SELECT rid FROM unnest(p_reviewer_ids) AS rid
--       WHERE rid NOT IN (
--         SELECT user_id FROM space_memberships
--         WHERE space_id = v_task.space_id
--           AND role IN ('admin', 'editor')
--       )
--     ) THEN
--       RAISE EXCEPTION 'One or more reviewer IDs are not internal members (admin/editor) of this space';
--     END IF;
--   
--     -- Upsert review (task_id is UNIQUE) — status determined after approval updates
--     INSERT INTO reviews (org_id, space_id, task_id, status, created_by)
--     VALUES (v_task.org_id, v_task.space_id, p_task_id, 'open', v_actor_id)
--     ON CONFLICT (task_id) DO UPDATE SET updated_at = now()
--     RETURNING id INTO v_review_id;
--   
--     -- Get currently existing reviewer IDs
--     SELECT COALESCE(array_agg(reviewer_id), '{}')
--     INTO v_existing_reviewer_ids
--     FROM review_approvals
--     WHERE review_id = v_review_id;
--   
--     -- Remove reviewers no longer in the list
--     DELETE FROM review_approvals
--     WHERE review_id = v_review_id
--       AND reviewer_id != ALL(p_reviewer_ids);
--   
--     -- Add only NEW reviewers as 'pending' (preserve existing approvals)
--     INSERT INTO review_approvals (org_id, review_id, reviewer_id, state)
--     SELECT v_task.org_id, v_review_id, rid, 'pending'
--     FROM unnest(p_reviewer_ids) AS rid
--     WHERE rid != ALL(v_existing_reviewer_ids);
--   
--     -- Reset 'blocked' reviewers back to 'pending' on re-review
--     -- (approved items are preserved per REVIEW_SPEC)
--     UPDATE review_approvals
--     SET state = 'pending', blocked_reason = NULL, updated_at = now()
--     WHERE review_id = v_review_id AND state = 'blocked';
--   
--     -- Re-evaluate review status based on current approval states
--     SELECT EXISTS (
--       SELECT 1 FROM review_approvals
--       WHERE review_id = v_review_id AND state = 'pending'
--     ) INTO v_has_pending;
--   
--     IF v_has_pending THEN
--       v_final_status := 'open';
--     ELSE
--       v_final_status := 'approved';
--     END IF;
--   
--     UPDATE reviews SET status = v_final_status, updated_at = now()
--     WHERE id = v_review_id;
--   
--     -- Create audit log
--     INSERT INTO task_events (org_id, space_id, task_id, actor_id, meeting_id, action, payload)
--     VALUES (
--       v_task.org_id,
--       v_task.space_id,
--       p_task_id,
--       v_actor_id,
--       p_meeting_id,
--       'REVIEW_OPEN',
--       jsonb_build_object('reviewerIds', p_reviewer_ids)
--     );
--   
--     -- 承認を頼まれた人（いま保留中の承認者全員）の受信トレイにお知らせを作る。新しく加えた人と、差し戻しから
--     -- 保留中に戻った人の両方が入る。依頼した本人には作らない（20260703_000_collab_notifications.sql と同じ）。
--     -- 同じ依頼のお知らせがすでにあれば、未読・要対応に戻して一番上に出す。前の依頼に返事をしていた人
--     -- （差し戻し → もう一度の依頼）には、新しい依頼として即時メールも送り直す（まだ返事をしていない人には送り直さない）。
--     -- 前のお知らせを書き直すので、プッシュは出ない（プッシュは新しく作ったときだけ）
--     SELECT display_name INTO v_actor_name FROM profiles WHERE id = v_actor_id;
--   
--     FOR v_pending_reviewer IN
--       SELECT reviewer_id FROM review_approvals
--       WHERE review_id = v_review_id AND state = 'pending'
--     LOOP
--       IF v_pending_reviewer <> v_actor_id THEN
--         INSERT INTO notifications (org_id, space_id, to_user_id, channel, type, dedupe_key, payload)
--         VALUES (
--           v_task.org_id,
--           v_task.space_id,
--           v_pending_reviewer,
--           'in_app',
--           'review_request',
--           format('review_request:%s:%s', v_review_id, v_pending_reviewer),
--           jsonb_build_object(
--             'task_id', p_task_id,
--             'task_title', v_task.title,
--             'title', format('社内承認の依頼: 「%s」', v_task.title),
--             'message', '社内承認をお願いします。承認するか、理由を添えて差し戻してください。',
--             'from_user_name', v_actor_name
--           )
--         )
--         ON CONFLICT (to_user_id, channel, dedupe_key) DO UPDATE
--           SET payload = excluded.payload,
--               read_at = NULL,
--               actioned_at = NULL,
--               immediate_email_sent_at = CASE
--                 WHEN notifications.actioned_at IS NOT NULL THEN NULL
--                 ELSE notifications.immediate_email_sent_at
--               END,
--               created_at = now();
--       END IF;
--     END LOOP;
--   
--     RETURN jsonb_build_object('ok', true);
--   END;
--   $$;
--   drop function if exists public.rpc_review_open_as(uuid, uuid, uuid[], uuid);
--   drop function if exists public._review_open_impl(uuid, uuid, uuid[], uuid);
-- =============================================================================
-- 節 6: rpc_review_approve … 本体は _review_approve_impl(p_actor, …)。画面の rpc_review_approve は auth.uid() を、道具の rpc_review_approve_as は p_actor を渡す
--   本体は 20260911143112_space_role_boundary.sql の本文のまま。変えるのは、呼んだ人を p_actor から取る所と、
--   書き込める役割の確かめを _actor_can_write_space(v_actor_id, …) で行う所の2つだけ。
-- =============================================================================

create or replace function public._review_approve_impl(
  p_actor uuid,
  p_task_id uuid,
  p_meeting_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  v_task tasks%ROWTYPE;
  v_actor_id uuid;
  v_review_id uuid;
  v_review_space_id uuid;
  v_review_org_id uuid;
  v_all_approved boolean;
  v_updated_rows int;
BEGIN
  v_actor_id := p_actor;
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Get task
  SELECT * INTO v_task FROM tasks WHERE id = p_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found: %', p_task_id;
  END IF;

  -- Get review (+ space/org for the authorization anchor) and LOCK the row.
  -- Bug 1: without this lock, two reviewers approving the last two pending
  -- approvals concurrently can both observe v_all_approved=false under READ
  -- COMMITTED (each transaction reads review_approvals before the other's
  -- commit), leaving reviews.status stuck at 'open' even though every
  -- approval is 'approved'. FOR UPDATE serializes the two transactions so
  -- the second one re-reads a consistent state.
  SELECT id, space_id, org_id
  INTO v_review_id, v_review_space_id, v_review_org_id
  FROM reviews WHERE task_id = p_task_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No review found for task: %', p_task_id;
  END IF;

  -- 認可ガード（監査B2 / 越境IDOR対策）: 呼出元が対象 review の space/org に
  -- 書き込める役割（社内の admin / editor）か検証する。既存の reviewer_id チェックより前段の多層防御。
  IF NOT public._actor_can_write_space(v_actor_id, v_review_space_id, v_review_org_id) THEN
    RAISE EXCEPTION 'Not authorized to access this review';
  END IF;

  -- Update current user's approval. `AND state <> 'approved'` makes a
  -- re-run against an already-approved reviewer a no-op (Bug 4: idempotency).
  UPDATE review_approvals
  SET state = 'approved', updated_at = now()
  WHERE review_id = v_review_id AND reviewer_id = v_actor_id AND state <> 'approved';

  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;

  IF v_updated_rows = 0 THEN
    -- Either the caller is not a reviewer on this review, or they already
    -- approved. Disambiguate to preserve the original error for the former.
    IF NOT EXISTS (
      SELECT 1 FROM review_approvals
      WHERE review_id = v_review_id AND reviewer_id = v_actor_id
    ) THEN
      RAISE EXCEPTION 'User is not a reviewer for this task';
    END IF;

    -- Already approved: return current state without re-logging to
    -- task_events (Bug 4).
    SELECT NOT EXISTS (
      SELECT 1 FROM review_approvals
      WHERE review_id = v_review_id AND state != 'approved'
    ) INTO v_all_approved;

    RETURN jsonb_build_object('ok', true, 'allApproved', v_all_approved, 'alreadyApproved', true);
  END IF;

  -- Check if all reviewers approved (safe under the FOR UPDATE lock above).
  SELECT NOT EXISTS (
    SELECT 1 FROM review_approvals
    WHERE review_id = v_review_id AND state != 'approved'
  ) INTO v_all_approved;

  -- Update review status if all approved
  IF v_all_approved THEN
    UPDATE reviews SET status = 'approved', updated_at = now() WHERE id = v_review_id;
  END IF;

  -- Create audit log
  INSERT INTO task_events (org_id, space_id, task_id, actor_id, meeting_id, action, payload)
  VALUES (
    v_task.org_id,
    v_task.space_id,
    p_task_id,
    v_actor_id,
    p_meeting_id,
    'REVIEW_APPROVE',
    jsonb_build_object('allApproved', v_all_approved)
  );

  RETURN jsonb_build_object('ok', true, 'allApproved', v_all_approved);
END;
$$;

revoke execute on function public._review_approve_impl(uuid, uuid, uuid) from public, anon, authenticated, service_role;

create or replace function public.rpc_review_approve_as(
  p_actor uuid,
  p_task_id uuid,
  p_meeting_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public._review_approve_impl(p_actor, p_task_id, p_meeting_id);
end;
$$;

revoke execute on function public.rpc_review_approve_as(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.rpc_review_approve_as(uuid, uuid, uuid) to service_role;

create or replace function public.rpc_review_approve(
  p_task_id uuid,
  p_meeting_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public._review_approve_impl(auth.uid(), p_task_id, p_meeting_id);
end;
$$;

revoke execute on function public.rpc_review_approve(uuid, uuid) from public, anon;
grant execute on function public.rpc_review_approve(uuid, uuid) to authenticated, service_role;

-- ロールバック（節 6。画面の関数を土台の本文に戻し、道具用と本体を外す。実行権は今と同じ）:
--   CREATE OR REPLACE FUNCTION rpc_review_approve(
--     p_task_id uuid,
--     p_meeting_id uuid DEFAULT NULL
--   )
--   RETURNS jsonb
--   LANGUAGE plpgsql
--   SECURITY DEFINER
--   SET search_path = public
--   AS $$
--   DECLARE
--     v_task tasks%ROWTYPE;
--     v_actor_id uuid;
--     v_review_id uuid;
--     v_review_space_id uuid;
--     v_review_org_id uuid;
--     v_all_approved boolean;
--     v_updated_rows int;
--   BEGIN
--     v_actor_id := auth.uid();
--     IF v_actor_id IS NULL THEN
--       RAISE EXCEPTION 'Authentication required';
--     END IF;
--   
--     -- Get task
--     SELECT * INTO v_task FROM tasks WHERE id = p_task_id;
--     IF NOT FOUND THEN
--       RAISE EXCEPTION 'Task not found: %', p_task_id;
--     END IF;
--   
--     -- Get review (+ space/org for the authorization anchor) and LOCK the row.
--     -- Bug 1: without this lock, two reviewers approving the last two pending
--     -- approvals concurrently can both observe v_all_approved=false under READ
--     -- COMMITTED (each transaction reads review_approvals before the other's
--     -- commit), leaving reviews.status stuck at 'open' even though every
--     -- approval is 'approved'. FOR UPDATE serializes the two transactions so
--     -- the second one re-reads a consistent state.
--     SELECT id, space_id, org_id
--     INTO v_review_id, v_review_space_id, v_review_org_id
--     FROM reviews WHERE task_id = p_task_id
--     FOR UPDATE;
--     IF NOT FOUND THEN
--       RAISE EXCEPTION 'No review found for task: %', p_task_id;
--     END IF;
--   
--     -- 認可ガード（監査B2 / 越境IDOR対策）: 呼出元が対象 review の space/org に
--     -- 書き込める役割（社内の admin / editor）か検証する。既存の reviewer_id チェックより前段の多層防御。
--     IF NOT public.app_can_write_space(v_review_space_id, v_review_org_id) THEN
--       RAISE EXCEPTION 'Not authorized to access this review';
--     END IF;
--   
--     -- Update current user's approval. `AND state <> 'approved'` makes a
--     -- re-run against an already-approved reviewer a no-op (Bug 4: idempotency).
--     UPDATE review_approvals
--     SET state = 'approved', updated_at = now()
--     WHERE review_id = v_review_id AND reviewer_id = v_actor_id AND state <> 'approved';
--   
--     GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
--   
--     IF v_updated_rows = 0 THEN
--       -- Either the caller is not a reviewer on this review, or they already
--       -- approved. Disambiguate to preserve the original error for the former.
--       IF NOT EXISTS (
--         SELECT 1 FROM review_approvals
--         WHERE review_id = v_review_id AND reviewer_id = v_actor_id
--       ) THEN
--         RAISE EXCEPTION 'User is not a reviewer for this task';
--       END IF;
--   
--       -- Already approved: return current state without re-logging to
--       -- task_events (Bug 4).
--       SELECT NOT EXISTS (
--         SELECT 1 FROM review_approvals
--         WHERE review_id = v_review_id AND state != 'approved'
--       ) INTO v_all_approved;
--   
--       RETURN jsonb_build_object('ok', true, 'allApproved', v_all_approved, 'alreadyApproved', true);
--     END IF;
--   
--     -- Check if all reviewers approved (safe under the FOR UPDATE lock above).
--     SELECT NOT EXISTS (
--       SELECT 1 FROM review_approvals
--       WHERE review_id = v_review_id AND state != 'approved'
--     ) INTO v_all_approved;
--   
--     -- Update review status if all approved
--     IF v_all_approved THEN
--       UPDATE reviews SET status = 'approved', updated_at = now() WHERE id = v_review_id;
--     END IF;
--   
--     -- Create audit log
--     INSERT INTO task_events (org_id, space_id, task_id, actor_id, meeting_id, action, payload)
--     VALUES (
--       v_task.org_id,
--       v_task.space_id,
--       p_task_id,
--       v_actor_id,
--       p_meeting_id,
--       'REVIEW_APPROVE',
--       jsonb_build_object('allApproved', v_all_approved)
--     );
--   
--     RETURN jsonb_build_object('ok', true, 'allApproved', v_all_approved);
--   END;
--   $$;
--   drop function if exists public.rpc_review_approve_as(uuid, uuid, uuid);
--   drop function if exists public._review_approve_impl(uuid, uuid, uuid);
-- =============================================================================
-- 節 7: rpc_review_block … 本体は _review_block_impl(p_actor, …)。画面の rpc_review_block は auth.uid() を、道具の rpc_review_block_as は p_actor を渡す
--   本体は 20260911143112_space_role_boundary.sql の本文のまま。変えるのは、呼んだ人を p_actor から取る所と、
--   書き込める役割の確かめを _actor_can_write_space(v_actor_id, …) で行う所の2つだけ。
-- =============================================================================

create or replace function public._review_block_impl(
  p_actor uuid,
  p_task_id uuid,
  p_blocked_reason text,
  p_meeting_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  v_task tasks%ROWTYPE;
  v_actor_id uuid;
  v_review_id uuid;
  v_review_space_id uuid;
  v_review_org_id uuid;
  v_requester_id uuid;
  v_actor_name text;
  v_updated_rows int;
BEGIN
  v_actor_id := p_actor;
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Get task
  SELECT * INTO v_task FROM tasks WHERE id = p_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found: %', p_task_id;
  END IF;

  -- Get review (+ requester for the ball hand-back notification, + space/org
  -- anchor) and LOCK the row — same rationale as rpc_review_approve: without
  -- it, a block racing against the last concurrent approvals could observe
  -- a stale approval count.
  SELECT id, created_by, space_id, org_id
  INTO v_review_id, v_requester_id, v_review_space_id, v_review_org_id
  FROM reviews WHERE task_id = p_task_id
  FOR UPDATE;
  IF v_review_id IS NULL THEN
    RAISE EXCEPTION 'No review found for task: %', p_task_id;
  END IF;

  -- 認可ガード（監査B2 / 越境IDOR対策）: 呼出元が対象 review の space/org に
  -- 書き込める役割（社内の admin / editor）か検証する。既存の reviewer_id チェックより前段の多層防御。
  IF NOT public._actor_can_write_space(v_actor_id, v_review_space_id, v_review_org_id) THEN
    RAISE EXCEPTION 'Not authorized to access this review';
  END IF;

  -- Update current user's approval to blocked. Only counts as a real change
  -- (and triggers ball hand-back / notification / task_events below) if the
  -- state or the reason actually changed — a double-submit of the same
  -- reason is a no-op (Bug 4: symmetry with rpc_review_approve).
  UPDATE review_approvals
  SET state = 'blocked', blocked_reason = p_blocked_reason, updated_at = now()
  WHERE review_id = v_review_id
    AND reviewer_id = v_actor_id
    AND (state <> 'blocked' OR blocked_reason IS DISTINCT FROM p_blocked_reason);

  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;

  IF v_updated_rows = 0 THEN
    IF NOT EXISTS (
      SELECT 1 FROM review_approvals
      WHERE review_id = v_review_id AND reviewer_id = v_actor_id
    ) THEN
      RAISE EXCEPTION 'User is not a reviewer for this task';
    END IF;

    -- No actual change (identical repeat submission): idempotent no-op.
    RETURN jsonb_build_object('ok', true, 'alreadyBlocked', true);
  END IF;

  -- Update review status to changes_requested
  UPDATE reviews SET status = 'changes_requested', updated_at = now() WHERE id = v_review_id;

  -- Hand the ball back to the internal side (the developer must act on the
  -- requested changes). This makes the change-request an actionable state.
  UPDATE tasks SET ball = 'internal', updated_at = now() WHERE id = p_task_id;

  -- Create audit log
  INSERT INTO task_events (org_id, space_id, task_id, actor_id, meeting_id, action, payload)
  VALUES (
    v_task.org_id,
    v_task.space_id,
    p_task_id,
    v_actor_id,
    p_meeting_id,
    'REVIEW_BLOCK',
    jsonb_build_object('blockedReason', p_blocked_reason)
  );

  -- Notify the developer who requested the review (exclude self-block).
  SELECT display_name INTO v_actor_name FROM profiles WHERE id = v_actor_id;

  IF v_requester_id IS NOT NULL AND v_requester_id <> v_actor_id THEN
    PERFORM _create_task_notification(
      v_task.org_id,
      v_task.space_id,
      v_requester_id,
      'ball_passed',
      format('review_block:%s:%s', v_review_id, v_requester_id),
      jsonb_build_object(
        'task_id', p_task_id,
        'task_title', v_task.title,
        'title', format('差し戻し: 「%s」', v_task.title),
        'message', format('修正依頼: %s', p_blocked_reason),
        'from_user_name', v_actor_name,
        'ball', 'internal'
      )
    );
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

revoke execute on function public._review_block_impl(uuid, uuid, text, uuid) from public, anon, authenticated, service_role;

create or replace function public.rpc_review_block_as(
  p_actor uuid,
  p_task_id uuid,
  p_blocked_reason text,
  p_meeting_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public._review_block_impl(p_actor, p_task_id, p_blocked_reason, p_meeting_id);
end;
$$;

revoke execute on function public.rpc_review_block_as(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.rpc_review_block_as(uuid, uuid, text, uuid) to service_role;

create or replace function public.rpc_review_block(
  p_task_id uuid,
  p_blocked_reason text,
  p_meeting_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public._review_block_impl(auth.uid(), p_task_id, p_blocked_reason, p_meeting_id);
end;
$$;

revoke execute on function public.rpc_review_block(uuid, text, uuid) from public, anon;
grant execute on function public.rpc_review_block(uuid, text, uuid) to authenticated, service_role;

-- ロールバック（節 7。画面の関数を土台の本文に戻し、道具用と本体を外す。実行権は今と同じ）:
--   CREATE OR REPLACE FUNCTION rpc_review_block(
--     p_task_id uuid,
--     p_blocked_reason text,
--     p_meeting_id uuid DEFAULT NULL
--   )
--   RETURNS jsonb
--   LANGUAGE plpgsql
--   SECURITY DEFINER
--   SET search_path = public
--   AS $$
--   DECLARE
--     v_task tasks%ROWTYPE;
--     v_actor_id uuid;
--     v_review_id uuid;
--     v_review_space_id uuid;
--     v_review_org_id uuid;
--     v_requester_id uuid;
--     v_actor_name text;
--     v_updated_rows int;
--   BEGIN
--     v_actor_id := auth.uid();
--     IF v_actor_id IS NULL THEN
--       RAISE EXCEPTION 'Authentication required';
--     END IF;
--   
--     -- Get task
--     SELECT * INTO v_task FROM tasks WHERE id = p_task_id;
--     IF NOT FOUND THEN
--       RAISE EXCEPTION 'Task not found: %', p_task_id;
--     END IF;
--   
--     -- Get review (+ requester for the ball hand-back notification, + space/org
--     -- anchor) and LOCK the row — same rationale as rpc_review_approve: without
--     -- it, a block racing against the last concurrent approvals could observe
--     -- a stale approval count.
--     SELECT id, created_by, space_id, org_id
--     INTO v_review_id, v_requester_id, v_review_space_id, v_review_org_id
--     FROM reviews WHERE task_id = p_task_id
--     FOR UPDATE;
--     IF v_review_id IS NULL THEN
--       RAISE EXCEPTION 'No review found for task: %', p_task_id;
--     END IF;
--   
--     -- 認可ガード（監査B2 / 越境IDOR対策）: 呼出元が対象 review の space/org に
--     -- 書き込める役割（社内の admin / editor）か検証する。既存の reviewer_id チェックより前段の多層防御。
--     IF NOT public.app_can_write_space(v_review_space_id, v_review_org_id) THEN
--       RAISE EXCEPTION 'Not authorized to access this review';
--     END IF;
--   
--     -- Update current user's approval to blocked. Only counts as a real change
--     -- (and triggers ball hand-back / notification / task_events below) if the
--     -- state or the reason actually changed — a double-submit of the same
--     -- reason is a no-op (Bug 4: symmetry with rpc_review_approve).
--     UPDATE review_approvals
--     SET state = 'blocked', blocked_reason = p_blocked_reason, updated_at = now()
--     WHERE review_id = v_review_id
--       AND reviewer_id = v_actor_id
--       AND (state <> 'blocked' OR blocked_reason IS DISTINCT FROM p_blocked_reason);
--   
--     GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
--   
--     IF v_updated_rows = 0 THEN
--       IF NOT EXISTS (
--         SELECT 1 FROM review_approvals
--         WHERE review_id = v_review_id AND reviewer_id = v_actor_id
--       ) THEN
--         RAISE EXCEPTION 'User is not a reviewer for this task';
--       END IF;
--   
--       -- No actual change (identical repeat submission): idempotent no-op.
--       RETURN jsonb_build_object('ok', true, 'alreadyBlocked', true);
--     END IF;
--   
--     -- Update review status to changes_requested
--     UPDATE reviews SET status = 'changes_requested', updated_at = now() WHERE id = v_review_id;
--   
--     -- Hand the ball back to the internal side (the developer must act on the
--     -- requested changes). This makes the change-request an actionable state.
--     UPDATE tasks SET ball = 'internal', updated_at = now() WHERE id = p_task_id;
--   
--     -- Create audit log
--     INSERT INTO task_events (org_id, space_id, task_id, actor_id, meeting_id, action, payload)
--     VALUES (
--       v_task.org_id,
--       v_task.space_id,
--       p_task_id,
--       v_actor_id,
--       p_meeting_id,
--       'REVIEW_BLOCK',
--       jsonb_build_object('blockedReason', p_blocked_reason)
--     );
--   
--     -- Notify the developer who requested the review (exclude self-block).
--     SELECT display_name INTO v_actor_name FROM profiles WHERE id = v_actor_id;
--   
--     IF v_requester_id IS NOT NULL AND v_requester_id <> v_actor_id THEN
--       PERFORM _create_task_notification(
--         v_task.org_id,
--         v_task.space_id,
--         v_requester_id,
--         'ball_passed',
--         format('review_block:%s:%s', v_review_id, v_requester_id),
--         jsonb_build_object(
--           'task_id', p_task_id,
--           'task_title', v_task.title,
--           'title', format('差し戻し: 「%s」', v_task.title),
--           'message', format('修正依頼: %s', p_blocked_reason),
--           'from_user_name', v_actor_name,
--           'ball', 'internal'
--         )
--       );
--     END IF;
--   
--     RETURN jsonb_build_object('ok', true);
--   END;
--   $$;
--   drop function if exists public.rpc_review_block_as(uuid, uuid, text, uuid);
--   drop function if exists public._review_block_impl(uuid, uuid, text, uuid);
-- =============================================================================
-- 節 8: rpc_confirm_proposal_slot … 本体は _confirm_proposal_slot_impl(p_actor, …)。画面の rpc_confirm_proposal_slot は auth.uid() を、道具の rpc_confirm_proposal_slot_as は p_actor を渡す
--   本体は 20260911143112_space_role_boundary.sql の本文のまま。変えるのは、呼んだ人を p_actor から取る所と、
--   書き込める役割の確かめを _actor_can_write_space(v_actor_id, …) で行う所の2つだけ。
-- =============================================================================

create or replace function public._confirm_proposal_slot_impl(
  p_actor uuid,
  p_proposal_id uuid,
  p_slot_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
  v_actor_id := p_actor;
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

  -- 書き込める役割（社内の admin / editor）だけが通る
  IF NOT public._actor_can_write_space(v_actor_id, v_proposal.space_id, v_proposal.org_id) THEN
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

revoke execute on function public._confirm_proposal_slot_impl(uuid, uuid, uuid) from public, anon, authenticated, service_role;

create or replace function public.rpc_confirm_proposal_slot_as(
  p_actor uuid,
  p_proposal_id uuid,
  p_slot_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public._confirm_proposal_slot_impl(p_actor, p_proposal_id, p_slot_id);
end;
$$;

revoke execute on function public.rpc_confirm_proposal_slot_as(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.rpc_confirm_proposal_slot_as(uuid, uuid, uuid) to service_role;

create or replace function public.rpc_confirm_proposal_slot(
  p_proposal_id uuid,
  p_slot_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public._confirm_proposal_slot_impl(auth.uid(), p_proposal_id, p_slot_id);
end;
$$;

revoke execute on function public.rpc_confirm_proposal_slot(uuid, uuid) from public, anon;
grant execute on function public.rpc_confirm_proposal_slot(uuid, uuid) to authenticated, service_role;

-- ロールバック（節 8。画面の関数を土台の本文に戻し、道具用と本体を外す。実行権は今と同じ）:
--   CREATE OR REPLACE FUNCTION rpc_confirm_proposal_slot(
--     p_proposal_id uuid,
--     p_slot_id uuid
--   ) RETURNS jsonb
--   LANGUAGE plpgsql
--   SECURITY DEFINER
--   SET search_path = public
--   AS $$
--   DECLARE
--     v_actor_id uuid;
--     v_proposal scheduling_proposals%ROWTYPE;
--     v_slot proposal_slots%ROWTYPE;
--     v_meeting_id uuid;
--     v_required_count integer;
--     v_eligible_count integer;
--     v_is_authorized boolean := false;
--   BEGIN
--     -- Auth check
--     v_actor_id := auth.uid();
--     IF v_actor_id IS NULL THEN
--       RETURN jsonb_build_object('ok', false, 'error', 'authentication_required');
--     END IF;
--   
--     -- 1. Row lock
--     SELECT * INTO v_proposal
--     FROM scheduling_proposals
--     WHERE id = p_proposal_id
--     FOR UPDATE;
--   
--     IF v_proposal IS NULL THEN
--       RETURN jsonb_build_object('ok', false, 'error', 'proposal_not_found');
--     END IF;
--   
--     -- 2. Authorization: creator or space admin
--     IF v_proposal.created_by = v_actor_id THEN
--       v_is_authorized := true;
--     ELSE
--       SELECT EXISTS (
--         SELECT 1 FROM space_memberships
--         WHERE space_id = v_proposal.space_id
--           AND user_id = v_actor_id
--           AND role = 'admin'
--       ) INTO v_is_authorized;
--     END IF;
--   
--     IF NOT v_is_authorized THEN
--       RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
--     END IF;
--   
--     -- 書き込める役割（社内の admin / editor）だけが通る
--     IF NOT public.app_can_write_space(v_proposal.space_id, v_proposal.org_id) THEN
--       RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
--     END IF;
--   
--     -- 3. Status guard
--     IF v_proposal.status <> 'open' THEN
--       RETURN jsonb_build_object('ok', false, 'error', 'proposal_not_open', 'current_status', v_proposal.status);
--     END IF;
--   
--     -- 4. Slot belongs to this proposal
--     SELECT * INTO v_slot
--     FROM proposal_slots
--     WHERE id = p_slot_id AND proposal_id = p_proposal_id;
--   
--     IF v_slot IS NULL THEN
--       RETURN jsonb_build_object('ok', false, 'error', 'slot_not_found');
--     END IF;
--   
--     -- 5. Required respondent count (must be > 0)
--     SELECT count(*) INTO v_required_count
--     FROM proposal_respondents
--     WHERE proposal_id = p_proposal_id AND is_required = true;
--   
--     IF v_required_count = 0 THEN
--       RETURN jsonb_build_object('ok', false, 'error', 'no_required_respondents');
--     END IF;
--   
--     -- 6. Eligible count: explicitly constrain both slot AND proposal
--     SELECT count(*) INTO v_eligible_count
--     FROM slot_responses sr
--     JOIN proposal_respondents pr ON sr.respondent_id = pr.id
--     WHERE sr.slot_id = p_slot_id
--       AND pr.proposal_id = p_proposal_id
--       AND pr.is_required = true
--       AND sr.response IN ('available', 'unavailable_but_proceed');
--   
--     IF v_eligible_count < v_required_count THEN
--       RETURN jsonb_build_object(
--         'ok', false,
--         'error', 'not_all_agreed',
--         'required', v_required_count,
--         'eligible', v_eligible_count
--       );
--     END IF;
--   
--     -- 7. Create meeting
--     INSERT INTO meetings (org_id, space_id, title, held_at, status, created_by)
--     VALUES (
--       v_proposal.org_id,
--       v_proposal.space_id,
--       v_proposal.title,
--       v_slot.start_at,
--       'planned',
--       v_actor_id
--     )
--     RETURNING id INTO v_meeting_id;
--   
--     -- 8. Copy participants
--     INSERT INTO meeting_participants (org_id, space_id, meeting_id, user_id, side, created_by)
--     SELECT
--       v_proposal.org_id,
--       v_proposal.space_id,
--       v_meeting_id,
--       pr.user_id,
--       pr.side,
--       v_actor_id
--     FROM proposal_respondents pr
--     WHERE pr.proposal_id = p_proposal_id;
--   
--     -- 9. Update proposal
--     UPDATE scheduling_proposals
--     SET status = 'confirmed',
--         confirmed_slot_id = p_slot_id,
--         confirmed_meeting_id = v_meeting_id,
--         confirmed_at = now(),
--         confirmed_by = v_actor_id,
--         version = version + 1
--     WHERE id = p_proposal_id;
--   
--     RETURN jsonb_build_object(
--       'ok', true,
--       'meeting_id', v_meeting_id,
--       'slot_start', v_slot.start_at,
--       'slot_end', v_slot.end_at
--     );
--   END;
--   $$;
--   drop function if exists public.rpc_confirm_proposal_slot_as(uuid, uuid, uuid);
--   drop function if exists public._confirm_proposal_slot_impl(uuid, uuid, uuid);
-- =============================================================================
-- 節 9: 末尾の確認（何も変えない）… 関数の本文・SECURITY DEFINER・search_path・実行権が想定どおり。違えば止める。
--   実行権は public / anon / authenticated / service_role の順。
-- =============================================================================

do $$
declare
  v_bad text := '';
  v_got text;
  r     record;
begin
  for r in select * from (values
      ('public._actor_can_write_space(uuid,uuid,uuid)', 'dfd6a5e0f34ba912d3a7c4d416ad0051', 'false/false/false/false'),
      ('public._pass_ball_impl(uuid,uuid,text,uuid[],uuid[],text,uuid)', '9770cab542b96f792b921e3b70c87943', 'false/false/false/false'),
      ('public.rpc_pass_ball_as(uuid,uuid,text,uuid[],uuid[],text,uuid)', '6b2c804124524fe0149a2c0b2119cbaf', 'false/false/false/true'),
      ('public.rpc_pass_ball(uuid,text,uuid[],uuid[],text,uuid)', '06cd6c42ffe69843b61fabed11494726', 'false/false/true/true'),
      ('public._meeting_start_impl(uuid,uuid)', 'f04c1eeeb9525f163c21b7026ac04ea3', 'false/false/false/false'),
      ('public.rpc_meeting_start_as(uuid,uuid)', 'cf4f47978236489abdd58dea7072e25d', 'false/false/false/true'),
      ('public.rpc_meeting_start(uuid)', 'f5663e8fa4d43ad2ef9352c8174c9275', 'false/false/true/true'),
      ('public._meeting_end_impl(uuid,uuid)', '3cd9c5ac5e189c8a3ad780c351efdf46', 'false/false/false/false'),
      ('public.rpc_meeting_end_as(uuid,uuid)', '1ea38440c8e4b19fddb495261f155da5', 'false/false/false/true'),
      ('public.rpc_meeting_end(uuid)', '2c26a570ace49280c8123a11781278c3', 'false/false/true/true'),
      ('public._review_open_impl(uuid,uuid,uuid[],uuid)', 'e0dc15a3d94d19f79eb8fe2461ad3871', 'false/false/false/false'),
      ('public.rpc_review_open_as(uuid,uuid,uuid[],uuid)', 'bf03b3d8c22c68c15284e53165ac1ff6', 'false/false/false/true'),
      ('public.rpc_review_open(uuid,uuid[],uuid)', '60a60bc69073f6b8e9bef94a6f82b179', 'false/false/true/true'),
      ('public._review_approve_impl(uuid,uuid,uuid)', 'fd3140e13174335adce627b7a5e3b970', 'false/false/false/false'),
      ('public.rpc_review_approve_as(uuid,uuid,uuid)', 'c0822ce4d6a48ebfe8de1ac14e165713', 'false/false/false/true'),
      ('public.rpc_review_approve(uuid,uuid)', '59b48f243f06dd5bac4b9aacc27d3cb2', 'false/false/true/true'),
      ('public._review_block_impl(uuid,uuid,text,uuid)', 'cf8e7e8cc12b9bc563f34d8cc990ce9b', 'false/false/false/false'),
      ('public.rpc_review_block_as(uuid,uuid,text,uuid)', '026a63fb4a7d2bc89520d9278ccc79e1', 'false/false/false/true'),
      ('public.rpc_review_block(uuid,text,uuid)', '4d122a228074415d07f8e750e268195f', 'false/false/true/true'),
      ('public._confirm_proposal_slot_impl(uuid,uuid,uuid)', '7bc156d9ede429c1d7d58339c39f7e2e', 'false/false/false/false'),
      ('public.rpc_confirm_proposal_slot_as(uuid,uuid,uuid)', 'b1f04045dac8de5ecb2cb5e3a57a333f', 'false/false/false/true'),
      ('public.rpc_confirm_proposal_slot(uuid,uuid)', '916083eb4db06a46ddd79f03bfa4ad01', 'false/false/true/true')
    ) v(sig, want_md5, want_rights)
  loop
    select format('%s:%s:%s:%s/%s/%s/%s', md5(p.prosrc), p.prosecdef::text, array_to_string(p.proconfig, ';'),
                  has_function_privilege('public', p.oid, 'execute')::text,
                  has_function_privilege('anon', p.oid, 'execute')::text,
                  has_function_privilege('authenticated', p.oid, 'execute')::text,
                  has_function_privilege('service_role', p.oid, 'execute')::text)
      into v_got
      from pg_proc p
     where p.oid = to_regprocedure(r.sig);
    if v_got is distinct from format('%s:true:search_path=public:%s', r.want_md5, r.want_rights) then
      v_bad := v_bad || format(' %s=%s;', r.sig, coalesce(v_got, 'なし'));
    end if;
  end loop;

  if v_bad <> '' then
    raise exception 'mcp rpc as: 想定と違います:%', v_bad;
  end if;
end $$;

-- ロールバック（節 9）: なし（確かめるだけで、何も変えない）
-- =============================================================================
-- 検証:
--   0) ローカル: bash supabase/tests/run_mcp_rpc_as.sh（全 PASS）。RED=1 で本 migration 抜き。
--      scripts/verify-migrations-from-scratch.sh
--   1) 適用前（本番・読むだけ）: 節 0 と同じ（7本の本文の md5・判定のもとの3関数の md5）。
--   2) 適用後（本番）: 節 9 が通る。画面の7つの操作（ボールを渡す・会議の開始 / 終了・レビューの依頼 / 承認 /
--      差し戻し・日程の確定）が今までどおり動く。
-- =============================================================================
