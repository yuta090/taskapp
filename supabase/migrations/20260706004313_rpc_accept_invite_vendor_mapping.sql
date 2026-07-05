-- =============================================================================
-- rpc_accept_invite — vendor 招待の membership マッピング是正
-- =============================================================================
-- Problem:
--   rpc_accept_invite（20260704161919_rpc_authz_org_invite.sql 時点の定義）は
--   invite.role をそのまま org_memberships.role に入れ、space_memberships.role は
--   client 以外を一律 'editor' にしていた。
--
--   invites.role は 'client' | 'member' | 'vendor' の3値だが（invites_role_check、
--   20260308_000_agency_mode_foundation.sql）、LoginClient / auth/callback /
--   middleware の着地判定はすべて「org_memberships.role='client' かつ同org内の
--   space_memberships.role='vendor'」を vendor 判定の前提にしている
--   （src/lib/auth/resolveLanding.ts 等）。
--
--   vendor 招待をそのまま受諾すると:
--     - org_memberships.role = 'vendor'（org側にはこの値の判定分岐が無い）
--     - space_memberships.role = 'editor'（内部編集者相当の権限で着地）
--   となり、vendor 判定が機能せず、かつ本来 client 相当に絞られるべき権限が
--   editor 級で紐付いてしまう。
--
-- Fix (このマイグレーション):
--   membership マッピングを canonical化する。
--     invite.role 'client' → org 'client' / space 'client'
--     invite.role 'vendor' → org 'client' / space 'vendor'
--     invite.role 'member' → org 'member' / space 'editor'
--   limits チェックは vendor も client 枠として扱う（vendor は組織外部の協力会社で
--   あり、内部メンバー枠(members)ではなくクライアント枠(clients)を消費する想定）。
--
--   上記以外のロジック（本人一致ガード、招待の取得条件、accepted_at 更新、
--   返却JSONの形— role は invite.role をそのまま返す）は
--   20260704161919_rpc_authz_org_invite.sql の定義を完全に維持する。
--
-- Scope / 非破壊性:
--   関数の再定義（create or replace）のみ。テーブル/データ/シグネチャ/戻り値の
--   形は変更しない。grant/revoke は現行状態
--   （20260705084441_rpc_accept_invite_service_role_only.sql で service_role 専用化
--   済み）を維持する。
-- =============================================================================

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

  return jsonb_build_object(
    'org_id', v_invite.org_id,
    'space_id', v_invite.space_id,
    'role', v_invite.role
  );
end;
$$;


-- =============================================================================
-- Grants: 現行状態（service_role 専用）を維持（冪等・再実行安全）。
-- =============================================================================
revoke execute on function rpc_accept_invite(text, uuid) from public, anon, authenticated;
grant  execute on function rpc_accept_invite(text, uuid) to service_role;


-- =============================================================================
-- 検証（適用後の想定手動確認）:
--   A) search_path 固定と SECURITY DEFINER が維持されていること:
--        select proname, prosecdef, proconfig from pg_proc
--         where proname = 'rpc_accept_invite';
--      → prosecdef=true、proconfig に search_path=public を含むこと。
--   B) EXECUTE 境界（変更していないこと）:
--        select has_function_privilege('service_role',
--          'rpc_accept_invite(text, uuid)', 'EXECUTE');       -- → true
--        select has_function_privilege('anon',
--          'rpc_accept_invite(text, uuid)', 'EXECUTE');       -- → false
--        select has_function_privilege('authenticated',
--          'rpc_accept_invite(text, uuid)', 'EXECUTE');       -- → false
--   C) マッピング回帰確認:
--        - role='client' の招待受諾 → org_memberships.role='client',
--          space_memberships.role='client'。
--        - role='vendor' の招待受諾 → org_memberships.role='client',
--          space_memberships.role='vendor'（ログイン後 /vendor-portal に着地すること）。
--        - role='member' の招待受諾 → org_memberships.role='member',
--          space_memberships.role='editor'。
--
-- ロールバック（不可逆な変更は無い。関数の再定義のみ）:
--   * 20260704161919_rpc_authz_org_invite.sql の rpc_accept_invite 定義を
--     再度 create or replace で流し直せばマッピング是正前に戻る
--     （grant/revoke は本マイグレーションと同一のため変更不要）。
-- =============================================================================
