-- =============================================================================
-- Invite Token Expiry: 30 days → 90 days
-- =============================================================================
-- 長期プロジェクトでクライアントが突然アクセスできなくなる問題を解決。
-- 既存の有効な招待リンクには影響を与えない（新規発行分から90日適用）。

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
begin
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
