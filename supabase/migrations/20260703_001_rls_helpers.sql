-- =============================================================================
-- RLS Rollout Stage 1-a — メンバーシップ判定ヘルパ関数
-- 詳細: docs/spec/RLS_ROLLOUT_SPEC.md（1-a）
--
-- 目的: RLS ポリシーが「自テナントの行だけ」に絞るために必要な
--       メンバーシップ判定を、再帰(policy→policy)を作らずに提供する。
--
-- ★ 再帰回避の肝（必読）:
--   これらは全て SECURITY DEFINER（定義者=postgres）で実行される。
--   そのため関数本体からの org_memberships / space_memberships への SELECT は
--   ★呼び出し元(authenticated)の RLS ポリシーをバイパスして★ 直接読む。
--   → membership テーブルに将来 RLS ポリシーを付けても、そのポリシー内で
--     再びこれらの関数を呼ぶような循環が発生せず、無限再帰(42P17)を回避できる。
--   membership 側のポリシーは「user_id = auth.uid()（自分の行）」のように
--   ヘルパを呼ばずに自己完結させること（本ファイルの範囲外）。
--
-- 実行者: 判定は常に auth.uid()（現在ログイン中のユーザー）を基準に行う。
--         auth.uid() が NULL（未認証/service_role経由）なら exists は偽になり、
--         RLS ポリシー側では「行なし」に倒れる（service_role は元々 RLS バイパス）。
--
-- 冪等: create or replace。破壊的操作なし（関数の作成/置換のみ）。
-- 可逆: 末尾のロールバック節参照（drop function）。
-- =============================================================================

-- org のメンバーか（ロール不問: owner/admin/member/client/vendor いずれでも真）
create or replace function public.app_is_org_member(p_org uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  -- SECURITY DEFINER: RLS をバイパスして org_memberships を直接参照する
  select exists(
    select 1 from org_memberships m
    where m.org_id = p_org
      and m.user_id = auth.uid()
  );
$$;

-- org の「内部」メンバーか（owner/admin/member のみ）
--   内部メンバーは org 内の全スペースにアクセス可という設計の根拠になる。
create or replace function public.app_is_org_internal(p_org uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  -- SECURITY DEFINER: RLS をバイパスして org_memberships を直接参照する
  select exists(
    select 1 from org_memberships m
    where m.org_id = p_org
      and m.user_id = auth.uid()
      and m.role in ('owner','admin','member')
  );
$$;

-- 特定 space のメンバーか（ロール不問。client/vendor はここに登録された自スペースのみ）
create or replace function public.app_is_space_member(p_space uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  -- SECURITY DEFINER: RLS をバイパスして space_memberships を直接参照する
  select exists(
    select 1 from space_memberships s
    where s.space_id = p_space
      and s.user_id = auth.uid()
  );
$$;

-- space へアクセス可能か（space スコープ・テーブルの標準判定）
--   内部メンバー(owner/admin/member) は org 内全スペース可、
--   client/vendor は自スペース(space_memberships にある space)のみ可。
create or replace function public.app_can_access_space(p_space uuid, p_org uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  -- 両ヘルパも SECURITY DEFINER のため RLS バイパスで membership を読む
  select public.app_is_space_member(p_space)
      or public.app_is_org_internal(p_org);
$$;

-- =============================================================================
-- 検証（検証ゲート#1 / SPEC 5-1）:
--   1) 関数が作成されたか:
--        select proname, prosecdef from pg_proc
--          where proname in
--            ('app_is_org_member','app_is_org_internal',
--             'app_is_space_member','app_can_access_space');
--      prosecdef が全て true（SECURITY DEFINER）であること。
--   2) membership テーブルへ将来 RLS を付けた後、authenticated として
--        select * from space_memberships;
--      が 無限再帰(42P17) を出さないこと（本ファイルでは membership に RLS を
--      付けないため、この段階では単に正常応答すればよい）。
--
-- ロールバック（必要時に手動実行）:
--   drop function if exists public.app_can_access_space(uuid, uuid);
--   drop function if exists public.app_is_space_member(uuid);
--   drop function if exists public.app_is_org_internal(uuid);
--   drop function if exists public.app_is_org_member(uuid);
--   ※ これらを参照する RLS ポリシー（20260703_002_rls_tasks.sql 等）を先に
--     drop してから関数を drop すること（依存順序に注意）。
-- =============================================================================
