-- =============================================================================
-- membership 書込RPC — メンバーのロール変更・削除を RPC 化（無音失敗の修正）
--
-- 問題:
--   20260703_003_rls_membership.sql により org_memberships / space_memberships の
--   INSERT/UPDATE/DELETE は authenticated から常に拒否される設計になっている
--   （ポリシー0件＝全拒否）。しかし UI（設定画面）は今もブラウザから直接
--   `.update()` / `.delete()` を発行しており、RLSで0行更新・0行削除になっても
--   Supabase-js はエラーを返さないため「役割を変更しました」「削除しました」と
--   成功トーストが出る（実DBは無変更のまま＝無音失敗）。
--
-- 解決: SECURITY DEFINER の書込RPCを4本新設し、UI側をRPC呼び出しに切替える
--   （UI切替は別コミットのアプリケーションコード側で対応）。
--   1. rpc_update_org_member_role — org owner のみ実行可。最終オーナー降格ガード。
--   2. rpc_remove_org_member      — org owner のみ実行可。最終オーナー削除ガード。
--                                    org削除時は配下spaceのspace_membershipsも連鎖削除。
--   3. rpc_update_space_member_role — org owner または space admin が実行可。
--   4. rpc_remove_space_member      — 同上の認可。
--
-- 冪等: create or replace function のため再実行安全。
-- ロールバック（末尾参照）: drop function で復元（RLSは無変更のため書込は
--   再び全拒否＝旧来の「無音失敗」状態に戻るだけで、閲覧系には影響なし）。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) rpc_update_org_member_role
-- -----------------------------------------------------------------------------
create or replace function rpc_update_org_member_role(
  p_org_id uuid,
  p_user_id uuid,
  p_role text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_target_role text;
  v_owner_count int;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1 from org_memberships
    where org_id = p_org_id and user_id = v_actor and role = 'owner'
  ) then
    raise exception 'Not authorized: only org owners can change member roles';
  end if;

  if p_role not in ('owner', 'member', 'client') then
    raise exception 'Invalid role: %', p_role;
  end if;

  select role into v_target_role
  from org_memberships
  where org_id = p_org_id and user_id = p_user_id;

  if v_target_role is null then
    raise exception 'Member not found';
  end if;

  -- 最終オーナーガード: 変更後にownerが0人になるなら拒否
  if v_target_role = 'owner' and p_role <> 'owner' then
    select count(*) into v_owner_count
    from org_memberships
    where org_id = p_org_id and role = 'owner';

    if v_owner_count <= 1 then
      raise exception 'Cannot demote the last owner';
    end if;
  end if;

  update org_memberships
  set role = p_role
  where org_id = p_org_id and user_id = p_user_id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function rpc_update_org_member_role(uuid, uuid, text) from public;
revoke execute on function rpc_update_org_member_role(uuid, uuid, text) from anon;
grant execute on function rpc_update_org_member_role(uuid, uuid, text) to authenticated;
grant execute on function rpc_update_org_member_role(uuid, uuid, text) to service_role;

-- -----------------------------------------------------------------------------
-- 2) rpc_remove_org_member
-- -----------------------------------------------------------------------------
create or replace function rpc_remove_org_member(
  p_org_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_target_role text;
  v_owner_count int;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1 from org_memberships
    where org_id = p_org_id and user_id = v_actor and role = 'owner'
  ) then
    raise exception 'Not authorized: only org owners can remove members';
  end if;

  select role into v_target_role
  from org_memberships
  where org_id = p_org_id and user_id = p_user_id;

  if v_target_role is null then
    raise exception 'Member not found';
  end if;

  if v_target_role = 'owner' then
    select count(*) into v_owner_count
    from org_memberships
    where org_id = p_org_id and role = 'owner';

    if v_owner_count <= 1 then
      raise exception 'Cannot remove the last owner';
    end if;
  end if;

  delete from org_memberships
  where org_id = p_org_id and user_id = p_user_id;

  -- 連鎖削除: このorg配下のspaceに残るspace_membershipsも削除
  delete from space_memberships
  where user_id = p_user_id
    and space_id in (select id from spaces where org_id = p_org_id);

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function rpc_remove_org_member(uuid, uuid) from public;
revoke execute on function rpc_remove_org_member(uuid, uuid) from anon;
grant execute on function rpc_remove_org_member(uuid, uuid) to authenticated;
grant execute on function rpc_remove_org_member(uuid, uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 3) rpc_update_space_member_role
-- -----------------------------------------------------------------------------
create or replace function rpc_update_space_member_role(
  p_space_id uuid,
  p_user_id uuid,
  p_role text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_org_id uuid;
  v_target_role text;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'Authentication required';
  end if;

  select org_id into v_org_id from spaces where id = p_space_id;
  if v_org_id is null then
    raise exception 'Space not found';
  end if;

  if not exists (
    select 1 from org_memberships
    where org_id = v_org_id and user_id = v_actor and role = 'owner'
    union
    select 1 from space_memberships
    where space_id = p_space_id and user_id = v_actor and role = 'admin'
  ) then
    raise exception 'Not authorized: only org owners or space admins can change member roles';
  end if;

  if p_role not in ('admin', 'editor', 'viewer', 'client', 'vendor') then
    raise exception 'Invalid role: %', p_role;
  end if;

  select role into v_target_role
  from space_memberships
  where space_id = p_space_id and user_id = p_user_id;

  if v_target_role is null then
    raise exception 'Member not found';
  end if;

  update space_memberships
  set role = p_role
  where space_id = p_space_id and user_id = p_user_id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function rpc_update_space_member_role(uuid, uuid, text) from public;
revoke execute on function rpc_update_space_member_role(uuid, uuid, text) from anon;
grant execute on function rpc_update_space_member_role(uuid, uuid, text) to authenticated;
grant execute on function rpc_update_space_member_role(uuid, uuid, text) to service_role;

-- -----------------------------------------------------------------------------
-- 4) rpc_remove_space_member
-- -----------------------------------------------------------------------------
create or replace function rpc_remove_space_member(
  p_space_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_org_id uuid;
  v_target_role text;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'Authentication required';
  end if;

  select org_id into v_org_id from spaces where id = p_space_id;
  if v_org_id is null then
    raise exception 'Space not found';
  end if;

  if not exists (
    select 1 from org_memberships
    where org_id = v_org_id and user_id = v_actor and role = 'owner'
    union
    select 1 from space_memberships
    where space_id = p_space_id and user_id = v_actor and role = 'admin'
  ) then
    raise exception 'Not authorized: only org owners or space admins can remove members';
  end if;

  select role into v_target_role
  from space_memberships
  where space_id = p_space_id and user_id = p_user_id;

  if v_target_role is null then
    raise exception 'Member not found';
  end if;

  delete from space_memberships
  where space_id = p_space_id and user_id = p_user_id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function rpc_remove_space_member(uuid, uuid) from public;
revoke execute on function rpc_remove_space_member(uuid, uuid) from anon;
grant execute on function rpc_remove_space_member(uuid, uuid) to authenticated;
grant execute on function rpc_remove_space_member(uuid, uuid) to service_role;

-- =============================================================================
-- 検証:
--   1) org owner が rpc_update_org_member_role / rpc_remove_org_member を実行でき、
--      member/client は Not authorized で拒否されること。
--   2) 最後の owner を 'member' に変更しようとすると 'Cannot demote the last owner'、
--      削除しようとすると 'Cannot remove the last owner' で拒否されること。
--   3) org member を削除すると、そのユーザーの配下space_membershipsも消えること。
--   4) space admin / org owner が rpc_update_space_member_role / rpc_remove_space_member
--      を実行でき、editor/viewer/client/vendor は Not authorized で拒否されること。
--   5) 未認証（auth.uid() is null）で全4関数が 'Authentication required' になること。
--   6) anon ロールに EXECUTE 権限がないこと（\df+ で確認 or REVOKE後の呼び出しが失敗）。
--
-- ロールバック（1グループでも破綻したら即実行）:
--   drop function if exists rpc_update_org_member_role(uuid, uuid, text);
--   drop function if exists rpc_remove_org_member(uuid, uuid);
--   drop function if exists rpc_update_space_member_role(uuid, uuid, text);
--   drop function if exists rpc_remove_space_member(uuid, uuid);
--   ※ RLSの書込ポリシーは元から0件（全拒否）のため、関数削除だけで
--     UI側が旧コードに戻れば挙動は「無音失敗」に戻るのみ（新規の破壊なし）。
-- =============================================================================
