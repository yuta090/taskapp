-- =============================================================================
-- rpc_create_invite: 認可の欠落を修正（なりすまし・匿名呼び出しの封鎖）
--
-- 問題:
--   1. p_created_by を呼び出し元の申告のまま信頼しており、auth.uid() との一致を
--      検証していなかった。管理者のIDを渡せば他人として招待を作成できる
--      （クライアントが自分を admin 招待する権限昇格が可能）。
--   2. anon に EXECUTE が付与されており、未ログインでも呼び出せた。
--   3. 20260317_000_invite_90_days.sql の再定義で 20240103 の owner/admin
--      認可チェックが脱落していた（90日化と引き換えに認可が消えるリグレッション）。
--
-- 解決: auth.uid() = p_created_by の強制＋org owner / space admin チェックの
--       復元＋anon からの EXECUTE 剥奪。90日有効・制限チェックは維持。
--       呼び出し元 (POST /api/invites) はユーザーセッションで p_created_by:
--       user.id を渡しているため互換。
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
begin
  -- Security: caller must be authenticated and act as themselves
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'Authentication required';
  end if;
  if v_actor <> p_created_by then
    raise exception 'Not authorized: p_created_by must be the authenticated user';
  end if;

  -- Security: only org owners or space admins may create invites
  if not exists (
    select 1 from org_memberships
    where org_id = p_org_id and user_id = v_actor and role = 'owner'
    union
    select 1 from space_memberships
    where space_id = p_space_id and user_id = v_actor and role = 'admin'
  ) then
    raise exception 'Not authorized to create invites';
  end if;

  -- Validate role
  if p_role not in ('client', 'member') then
    raise exception 'Invalid role: %', p_role;
  end if;

  -- Check limits
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
  values (p_org_id, p_space_id, p_email, p_role, v_token, now() + interval '90 days', p_created_by)
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
