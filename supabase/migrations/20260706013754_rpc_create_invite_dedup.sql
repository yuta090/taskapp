-- =============================================================================
-- rpc_create_invite: 重複招待の防止 ＋ 認可のAPI層整合
--
-- 問題:
--   1. 無条件 INSERT のため、同一 (org_id, space_id, email) への連打で有効な
--      招待行が乱立する。既存メンバーへも招待できてしまい重複が防げない。
--   2. 認可が「org owner または space admin」のみで、API層
--      （api/invites/route.ts: 「org∈{owner,member} かつ space∈{admin,editor}」）
--      と不一致だった。
--
-- 解決:
--   A. 同一 (org_id, space_id, lower(email)) に有効な保留招待
--      （accepted_at is null かつ expires_at > now()）が既にあれば、
--      新規 INSERT せず expires_at を90日延長して既存 token を返す
--      （冪等な再送。プラン上限チェックもスキップ＝新規追加ではないため）。
--   B. 宛先メールが既にそのorgのメンバーなら 'already a member' 例外を送出
--      （auth.users を lower(email) で突合。呼出元 API は 409 にマップする）。
--   C. 認可を「org owner、または（org member かつ 対象spaceの admin/editor）」
--      に変更し、API層の実効ルールに合わせる。
--
-- auth.uid() = p_created_by の強制／anon からの EXECUTE 剥奪／90日有効は
-- 20260705135847_rpc_create_invite_authz.sql から維持。
-- =============================================================================

create or replace function rpc_create_invite(
  p_org_id uuid,
  p_space_id uuid,
  p_email text,
  p_role text,
  p_created_by uuid
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_token text;
  v_invite_id uuid;
  v_limits jsonb;
  v_actor uuid;
  v_normalized_email text;
  v_existing_invite record;
  v_existing_member_user_id uuid;
  v_new_expires_at timestamptz;
begin
  v_normalized_email := lower(trim(p_email));

  -- Security: caller must be authenticated and act as themselves
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'Authentication required';
  end if;
  if v_actor <> p_created_by then
    raise exception 'Not authorized: p_created_by must be the authenticated user';
  end if;

  -- Security: org owner, or (org member and space admin/editor) — API層と整合
  if not exists (
    select 1 from org_memberships
    where org_id = p_org_id and user_id = v_actor and role = 'owner'
    union
    select 1
    from org_memberships om
    join space_memberships sm
      on sm.space_id = p_space_id and sm.user_id = v_actor and sm.role in ('admin', 'editor')
    where om.org_id = p_org_id and om.user_id = v_actor and om.role = 'member'
  ) then
    raise exception 'Not authorized to create invites';
  end if;

  -- Validate role
  if p_role not in ('client', 'member') then
    raise exception 'Invalid role: %', p_role;
  end if;

  -- Idempotent resend: 同一宛先への有効な保留招待が既にあれば延長して返す（新規カウントしない）
  select * into v_existing_invite
  from invites
  where org_id = p_org_id
    and space_id = p_space_id
    and lower(email) = v_normalized_email
    and accepted_at is null
    and expires_at > now()
  order by created_at desc
  limit 1;

  if found then
    v_new_expires_at := now() + interval '90 days';

    update invites
    set expires_at = v_new_expires_at
    where id = v_existing_invite.id;

    return jsonb_build_object(
      'invite_id', v_existing_invite.id,
      'token', v_existing_invite.token,
      'expires_at', v_new_expires_at::text
    );
  end if;

  -- 宛先が既にそのorgのメンバーなら拒否
  select u.id into v_existing_member_user_id
  from auth.users u
  where lower(u.email) = v_normalized_email;

  if v_existing_member_user_id is not null and exists (
    select 1 from org_memberships
    where org_id = p_org_id and user_id = v_existing_member_user_id
  ) then
    raise exception 'already a member';
  end if;

  -- Check limits (新規招待の場合のみ)
  v_limits := rpc_check_org_limits(p_org_id);

  if p_role = 'client' then
    if not (v_limits->'clients'->>'can_add')::boolean then
      raise exception 'Organization has reached client limit. Please upgrade your plan.';
    end if;
  else
    if not (v_limits->'members'->>'can_add')::boolean then
      raise exception 'Organization has reached member limit. Please upgrade your plan.';
    end if;
  end if;

  -- Generate token
  v_token := gen_random_uuid()::text;

  -- Create invite (90 days expiry)
  insert into invites (org_id, space_id, email, role, token, expires_at, created_by)
  values (p_org_id, p_space_id, v_normalized_email, p_role, v_token, now() + interval '90 days', p_created_by)
  returning id into v_invite_id;

  return jsonb_build_object(
    'invite_id', v_invite_id,
    'token', v_token,
    'expires_at', (now() + interval '90 days')::text
  );
end;
$$;

revoke execute on function rpc_create_invite(uuid, uuid, text, text, uuid) from anon;
revoke execute on function rpc_create_invite(uuid, uuid, text, text, uuid) from public;
grant execute on function rpc_create_invite(uuid, uuid, text, text, uuid) to authenticated;
grant execute on function rpc_create_invite(uuid, uuid, text, text, uuid) to service_role;
