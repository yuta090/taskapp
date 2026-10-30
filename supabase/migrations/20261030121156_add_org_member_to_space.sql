-- 組織の既存メンバーを、招待メールを送らずにプロジェクトへ追加する（役割を選んで）。
--
-- これまでは招待（rpc_create_invite）が「組織のメンバーなら拒否」だけで、組織にはいるが
-- そのプロジェクトにはいない人を入れる手段が無かった（2026-10-30・新しいプロジェクトに
-- 宮田さんを招待すると「既にメンバーです」で止まり、一覧にも返事待ちにも出なかった）。
--
-- 1. rpc_create_invite: このプロジェクトに既にいる人は 'already in space' で断る（組織にいるだけの人と分ける）。
--    本体は本番の定義をそのまま写し、この判定だけを足した
-- 2. rpc_add_space_member_by_email: 組織のメンバーをプロジェクトに入れる
--    - 呼べる人は招待と同じ（組織の owner、または組織 member かつこのプロジェクトの admin / editor）
--    - 管理者（admin）を付けられるのは、組織の owner かこのプロジェクトの admin だけ
--    - 付けられる役割は rpc_update_space_member_role と同じ決まり（社内 → admin / editor / viewer、
--      相手先 → client / vendor・vendor は代理店モードだけ）
--    - security definer は RLS の「二段階認証を済ませていること」を通らないので、ここで確かめる

create or replace function public.rpc_create_invite(p_org_id uuid, p_space_id uuid, p_email text, p_role text, p_created_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- 宛先が既にそのorgのメンバーなら拒否（使い回しより前に確かめる: 招待を出したあとにその組織へ参加した人の
  -- 古いリンクを、期限だけ延ばして返さないため）
  select u.id into v_existing_member_user_id
  from auth.users u
  where lower(u.email) = v_normalized_email;

  -- このプロジェクトに既にいる人と、組織にはいるがこのプロジェクトにはいない人を分けて返す。
  -- 後者は画面が「招待せずにそのまま追加する」（rpc_add_space_member_by_email）に切り替える
  if v_existing_member_user_id is not null and exists (
    select 1 from space_memberships
    where space_id = p_space_id and user_id = v_existing_member_user_id
  ) then
    raise exception 'already in space';
  end if;

  if v_existing_member_user_id is not null and exists (
    select 1 from org_memberships
    where org_id = p_org_id and user_id = v_existing_member_user_id
  ) then
    raise exception 'already a member';
  end if;

  -- Idempotent resend: 同じ宛先・同じ役割の有効な保留招待が既にあれば延長して返す（新規カウントしない）。
  -- 役割が違う保留招待は使い回さない（種類が違えばトリガーが断る・同じ種類で役割だけ違うなら新しく作る）
  select * into v_existing_invite
  from invites
  where org_id = p_org_id
    and space_id = p_space_id
    and lower(email) = v_normalized_email
    and role = p_role
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
$function$;


create or replace function public.rpc_add_space_member_by_email(p_space_id uuid, p_email text, p_role text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor uuid;
  v_org_id uuid;
  v_target_user_id uuid;
  v_target_org_role text;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'Authentication required';
  end if;
  if not public.mfa_satisfied() then
    raise exception 'MFA required';
  end if;

  select org_id into v_org_id from spaces where id = p_space_id;
  if v_org_id is null then
    raise exception 'Space not found';
  end if;

  -- 招待と同じ: 組織の owner、または組織 member かつこのプロジェクトの admin / editor
  if not exists (
    select 1 from org_memberships
    where org_id = v_org_id and user_id = v_actor and role = 'owner'
    union
    select 1
    from org_memberships om
    join space_memberships sm
      on sm.space_id = p_space_id and sm.user_id = v_actor and sm.role in ('admin', 'editor')
    where om.org_id = v_org_id and om.user_id = v_actor and om.role = 'member'
  ) then
    raise exception 'Not authorized to add members';
  end if;

  if p_role not in ('admin', 'editor', 'viewer', 'client', 'vendor') then
    raise exception 'Invalid role: %', p_role;
  end if;

  -- 管理者を付けられるのは管理者だけ（役割の変更と同じ）
  if p_role = 'admin' and not exists (
    select 1 from org_memberships
    where org_id = v_org_id and user_id = v_actor and role = 'owner'
    union
    select 1 from space_memberships
    where space_id = p_space_id and user_id = v_actor and role = 'admin'
  ) then
    raise exception '管理者の役割を付けられるのは、プロジェクトの管理者だけです';
  end if;

  select u.id into v_target_user_id
  from auth.users u
  where lower(u.email) = lower(trim(p_email));

  select om.role into v_target_org_role
  from org_memberships om
  where om.org_id = v_org_id and om.user_id = v_target_user_id;

  if v_target_org_role is null then
    raise exception 'この組織のメンバーではありません。招待を送ってください';
  end if;

  if exists (
    select 1 from space_memberships
    where space_id = p_space_id and user_id = v_target_user_id
  ) then
    raise exception 'already in space';
  end if;

  if v_target_org_role = 'client' and p_role not in ('client', 'vendor') then
    raise exception '相手先の人には、相手先の役割（client / vendor）しか付けられません';
  end if;

  if v_target_org_role <> 'client' and p_role not in ('admin', 'editor', 'viewer') then
    raise exception '社内のメンバーには、社内の役割（admin / editor / viewer）しか付けられません';
  end if;

  if p_role = 'vendor' and not exists (
    select 1 from spaces where id = p_space_id and agency_mode
  ) then
    raise exception '協力会社の役割（vendor）は、代理店モードのプロジェクトでだけ付けられます';
  end if;

  insert into space_memberships (space_id, user_id, role)
  values (p_space_id, v_target_user_id, p_role);

  return jsonb_build_object('ok', true, 'user_id', v_target_user_id, 'role', p_role);
end;
$function$;

revoke all on function public.rpc_add_space_member_by_email(uuid, text, text) from public, anon, authenticated;
grant execute on function public.rpc_add_space_member_by_email(uuid, text, text) to authenticated, service_role;
