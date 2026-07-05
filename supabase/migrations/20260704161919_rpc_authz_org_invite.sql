-- =============================================================================
-- RPC Authorization Hardening — 組織作成 / 招待受諾のなりすまし対策
-- =============================================================================
-- Problem:
--   以下の SECURITY DEFINER RPC は RLS をバイパスするにもかかわらず、渡された
--   p_user_id と呼出元（auth.uid()）の一致を検証していない。20260703_009_
--   rpc_authz_hardening.sql でも未対応だった。
--
--   1) rpc_create_org_with_billing(p_org_name, p_user_id)
--        認可チェックが皆無。既定で PUBLIC(=anon 含む) に EXECUTE があるため、
--        未認証者が任意の p_user_id を渡して「組織 + その user への owner 権限 +
--        free プランの billing」を作成できる（なりすまし / 権限昇格）。
--   2) rpc_accept_invite(p_token, p_user_id)
--        トークンさえ知っていれば、任意の p_user_id を org/space に紐付けできる
--        （auth.uid() と p_user_id の一致検証が無い）。
--
-- Fix (このマイグレーション):
--   各関数の冒頭（ミューテーション前）に「呼出元 == 対象ユーザー」ガードを追加。
--   設計方針・書式・コメントスタイルは 20260703_009_rpc_authz_hardening.sql に合わせる
--   （冒頭に認可ガード / SET search_path = public 固定 / 末尾で grant 境界を明示）。
--
--   ただし 2 つの関数で「未認証(anon)の扱い」が異なる（呼出フロー調査に基づく）:
--
--   ● rpc_create_org_with_billing … 厳格化（anon から EXECUTE 剥奪）
--       呼出元は signup と onboarding のみ。
--         - onboarding: supabase.auth.getUser() で認証を確認してから呼ぶ（常に認証済）。
--         - signup: メール確認が無効ならセッションあり、有効ならセッション無しで呼ばれる
--           経路が残っていたが、これは別ストリーム（fix/ux-audit-first-run-*）で
--           「セッションがある場合のみ呼ぶ」よう修正が同時進行中。本ハードニングは
--           それを前提とする。
--       → auth.uid() IS NULL または auth.uid() <> p_user_id なら例外。anon から
--         EXECUTE を剥奪し authenticated のみに限定する。
--       ★ このマイグレーションは fix/ux-audit-first-run-*（signup をセッション有り時
--         のみ RPC 呼出に修正）とセットでマージすること。単独適用すると、メール確認
--         有効時の signup 新規登録で組織作成が失敗する。
--
--   ● rpc_accept_invite … 認証済セッションがある場合のみ本人一致を強制（anon は維持）
--       呼出元は invite / portal / vendor-portal の 3 ページ。いずれも:
--         (a) 既存セッションがあれば session.user.id で自動受諾（auth.uid()==p_user_id）。
--         (b) 新規ユーザーは supabase.auth.signUp() 直後に authData.user.id で受諾。
--             メール確認が有効な場合 signUp はセッションを返さないため、この受諾は
--             anon（auth.uid() IS NULL）で実行される。
--       この (b) の anon 経路は現行フロー上必要で、20260703_008_rls_invites.sql も
--       「anon の招待受諾が DEFINER 経由で従来通り動作する」ことを前提に設計されている。
--       → よって anon からの EXECUTE は剥奪しない。認可ガードは
--         「auth.uid() が NOT NULL のときだけ auth.uid()==p_user_id を強制」とし、
--         ログイン済ユーザーが他人の id を紐付けることは防ぐ。
--       ▲ 残存リスク（後述の「残存リスク」節参照）: セッション無しの受諾経路では
--         トークン保持者が任意 p_user_id を org/space に紐付け可能なまま。恒久対応は
--         service_role を用いたサーバーサイド受諾 API 化。
--
--   なお rpc_validate_invite（招待ランディングの未ログイン表示に使用）は変更しない。
--   anon の実行を維持する必要があり、書込を伴わないため本ハードニングの対象外。
--
-- Scope / 非破壊性:
--   関数の再定義（create or replace）のみ。テーブル/データ/シグネチャ/戻り値/本来の
--   ロジックは一切変更しない。冒頭の本人一致ガードと search_path 固定だけを追加。
--   土台の定義は 20240103_000_auth_billing.sql（以降未改訂）。
-- =============================================================================


-- =============================================================================
-- 1. rpc_create_org_with_billing  （土台: 20240103_000_auth_billing.sql）
--    厳格化: auth.uid() が NULL もしくは p_user_id と不一致なら拒否。
-- =============================================================================
create or replace function rpc_create_org_with_billing(
  p_org_name text,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  -- 認可ガード（なりすまし / 権限昇格対策）: 呼出元は自分自身の user_id に対してのみ
  -- 組織を作成できる。未認証(anon)は不可。
  -- ★ signup をセッション有り時のみ呼ぶ修正（fix/ux-audit-first-run-*）とセットで適用。
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'Not authorized: caller must be the target user';
  end if;

  -- Create organization
  insert into organizations (name)
  values (p_org_name)
  returning id into v_org_id;

  -- Add user as owner
  insert into org_memberships (org_id, user_id, role)
  values (v_org_id, p_user_id, 'owner');

  -- Create billing with free plan
  insert into org_billing (org_id, plan_id)
  values (v_org_id, 'free');

  return jsonb_build_object(
    'org_id', v_org_id,
    'plan_id', 'free'
  );
end;
$$;


-- =============================================================================
-- 2. rpc_accept_invite  （土台: 20240103_000_auth_billing.sql）
--    認証済セッションがある場合のみ auth.uid()==p_user_id を強制。anon は維持。
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
begin
  -- 認可ガード: ログイン済みなら「自分自身の受諾」のみ許可。
  -- メール確認有効時の新規 signUp 直後はセッションが無く auth.uid() が NULL になる
  -- 正規経路があるため、その場合はここでは弾かない（anon EXECUTE も剥奪しない）。
  -- 残存リスク（トークン保持者が任意 user_id を紐付け可）はマイグレーション末尾参照。
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

  -- Check limits
  v_limits := rpc_check_org_limits(v_invite.org_id);

  if v_invite.role = 'client' then
    if not (v_limits->'clients'->>'can_add')::boolean then
      raise exception 'Organization has reached client limit';
    end if;
  else
    if not (v_limits->'members'->>'can_add')::boolean then
      raise exception 'Organization has reached member limit';
    end if;
  end if;

  -- Create org membership
  insert into org_memberships (org_id, user_id, role)
  values (v_invite.org_id, p_user_id, v_invite.role)
  on conflict (org_id, user_id) do nothing;

  -- Create space membership
  insert into space_memberships (space_id, user_id, role)
  values (
    v_invite.space_id,
    p_user_id,
    case v_invite.role
      when 'client' then 'client'
      else 'editor'
    end
  )
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
-- Grants: EXECUTE の境界を明示（冪等・再実行安全）。
--   - rpc_create_org_with_billing: PUBLIC/anon から剥奪し authenticated のみ。
--   - rpc_accept_invite: PUBLIC から剥奪しつつ anon を明示維持（新規 signUp 直後の
--     セッション無し受諾経路のため）。authenticated も付与。
-- =============================================================================
revoke execute on function rpc_create_org_with_billing(text, uuid) from public, anon;
grant  execute on function rpc_create_org_with_billing(text, uuid) to authenticated;

revoke execute on function rpc_accept_invite(text, uuid) from public;
grant  execute on function rpc_accept_invite(text, uuid) to anon, authenticated;


-- =============================================================================
-- 検証（適用後の想定手動確認）:
--   A) search_path 固定と SECURITY DEFINER が維持されていること:
--        select proname, prosecdef, proconfig from pg_proc
--         where proname in ('rpc_create_org_with_billing','rpc_accept_invite');
--      → prosecdef=true、proconfig に search_path=public を含むこと。
--   B) EXECUTE 境界:
--        select has_function_privilege('anon',
--          'rpc_create_org_with_billing(text, uuid)', 'EXECUTE');  -- → false
--        select has_function_privilege('authenticated',
--          'rpc_create_org_with_billing(text, uuid)', 'EXECUTE');  -- → true
--        select has_function_privilege('anon',
--          'rpc_accept_invite(text, uuid)', 'EXECUTE');            -- → true（維持）
--   C) なりすまし遮断（rpc_create_org_with_billing）:
--        - user A としてログイン中に p_user_id = user B を渡す → 'Not authorized'。
--        - 未認証(anon)で呼ぶ → EXECUTE 権限が無く失敗。
--        - user A が p_user_id = user A で呼ぶ → 従来どおり成功（回帰確認）。
--   D) なりすまし遮断（rpc_accept_invite）:
--        - user A としてログイン中に p_user_id = user B を渡す → 'Not authorized'。
--        - 未認証(anon)の新規 signUp 直後受諾（auth.uid() IS NULL, p_user_id=本人）
--          → 従来どおり成功（回帰確認 / 残存リスクは下記）。
--
-- 残存リスク（rpc_accept_invite / anon 経路）:
--   セッション無しで呼ばれる受諾経路では auth.uid() が NULL のためガードが素通りし、
--   有効な招待トークンの保持者が任意の p_user_id を対象 org/space に紐付け可能。
--   → 恒久対応案: 受諾処理を service_role を用いたサーバーサイド API（route handler）
--     に集約し、サーバー側で「今 signUp/ログインしたユーザー自身」であることを確認して
--     から service_role で受諾させる。これにより anon からの直接 RPC 実行を廃止できる。
--     その時点で anon の EXECUTE も剥奪可能になる（本マイグレーションの後続課題）。
--
-- ロールバック（不可逆な変更は無い。関数の再定義のみ）:
--   * 20240103_000_auth_billing.sql の該当 2 関数定義を再度 create or replace で
--     流し直せば認可ガード追加前に戻る。
--   * grant/revoke を戻す場合:
--       grant execute on function rpc_create_org_with_billing(text, uuid) to public;
--     （元は PUBLIC の既定 grant のみ。authenticated への明示 grant は残してよい。）
--   * データ変更・DDL 変更は無いため、データ側のロールバックは不要。
-- =============================================================================
