-- 招待の承諾時に「招待中の担当者」を本人へ引き継ぐ。
--
-- 20260910201312_task_assignee_invite.sql で tasks.assignee_invite_id を足したので、
-- 承諾のトランザクション内で assignee_id へ移す。関数の他の振る舞い（vendor マッピング・
-- 定員チェック・service_role 専用）は 20260706004313 のまま変えていない。
-- 冪等・再実行安全（create or replace）。

create or replace function rpc_accept_invite(
  p_token text,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite invites%rowtype;
  v_limits jsonb;
  v_org_role text;
  v_space_role text;
begin
  -- 認可ガード: ログイン済みなら「自分自身の受諾」のみ許可。
  -- メール確認有効時の新規 signUp 直後はセッションが無く auth.uid() が NULL になる
  -- 正規経路があるため、その場合はここでは弾かない。
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'Not authorized: caller must be the target user';
  end if;

  -- Get and validate invite
  select * into v_invite
  from invites
  where token = p_token
    and accepted_at is null
    and expires_at > now();

  if v_invite.id is null then
    raise exception 'Invalid or expired invite token';
  end if;

  -- Check limits（vendor は内部メンバー枠ではなくクライアント枠を消費する）
  v_limits := rpc_check_org_limits(v_invite.org_id);

  if v_invite.role in ('client', 'vendor') then
    if not (v_limits->'clients'->>'can_add')::boolean then
      raise exception 'Organization has reached client limit';
    end if;
  else
    if not (v_limits->'members'->>'can_add')::boolean then
      raise exception 'Organization has reached member limit';
    end if;
  end if;

  -- membership マッピングの canonical化:
  --   client → org 'client' / space 'client'
  --   vendor → org 'client' / space 'vendor'（vendor判定は org='client' + space='vendor'）
  --   member → org 'member' / space 'editor'
  if v_invite.role = 'vendor' then
    v_org_role := 'client';
    v_space_role := 'vendor';
  elsif v_invite.role = 'client' then
    v_org_role := 'client';
    v_space_role := 'client';
  else
    v_org_role := 'member';
    v_space_role := 'editor';
  end if;

  -- Create org membership
  insert into org_memberships (org_id, user_id, role)
  values (v_invite.org_id, p_user_id, v_org_role)
  on conflict (org_id, user_id) do nothing;

  -- Create space membership
  insert into space_memberships (space_id, user_id, role)
  values (v_invite.space_id, p_user_id, v_space_role)
  on conflict (space_id, user_id) do nothing;

  -- Mark invite as accepted
  update invites
  set accepted_at = now()
  where id = v_invite.id;

  -- 招待中の担当者として置かれていたタスクを、この人へ引き継ぐ（20260910201312_task_assignee_invite.sql）。
  -- 承諾と同じトランザクションで移すので「担当が一瞬空になる」状態を作らない。
  -- 排他制約（tasks_single_assignee_chk）があるため、同じ update で invite 側を null にする。
  update tasks
  set assignee_id = p_user_id,
      assignee_invite_id = null,
      updated_at = now()
  where assignee_invite_id = v_invite.id;

  return jsonb_build_object(
    'org_id', v_invite.org_id,
    'space_id', v_invite.space_id,
    'role', v_invite.role
  );
end;
$$;

revoke execute on function rpc_accept_invite(text, uuid) from public, anon, authenticated;
grant  execute on function rpc_accept_invite(text, uuid) to service_role;
