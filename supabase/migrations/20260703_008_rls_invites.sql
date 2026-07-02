-- =============================================================================
-- RLS Rollout Stage 1 — invites（機微・招待トークンを含む最終グループ）
-- 詳細: docs/spec/RLS_ROLLOUT_SPEC.md（1-b invites / 1-c 適用順 #7）
-- 依存: 20260703_001_rls_helpers.sql（app_is_org_internal）を先に適用。
--
-- ★ 機微データの扱い（最優先）:
--   invites は招待トークン（token 列・unique）を含む。トークンが漏れると招待の
--   なりすまし受諾が可能になるため、authenticated への露出を最小化する。
--   → SELECT は「org の内部管理者(owner/admin/member)」のみに限定する。
--     client/vendor ロールや他 org のユーザーには一切見せない。
--
-- 採用ポリシー（src の書込経路調査に基づく）:
--   SELECT のみ: app_is_org_internal(org_id)
--   （src の直接参照は admin(service_role) の管理画面と api/invites/route.ts のみ。
--    authenticated 経由の直接 SELECT は管理者向け一覧の将来利用に備えて内部限定で許可。
--    書込は SECURITY DEFINER RPC rpc_create_invite / rpc_accept_invite 経由のため
--    INSERT/UPDATE/DELETE ポリシーは作らない＝authenticated からの直接書込は全拒否）
--
-- ★ anon（未認証）の招待受諾フローへの影響なし:
--   anon のトークン検証は SECURITY DEFINER 関数 rpc_validate_invite に一本化されており
--   （RLS バイパス）、anon にテーブル直接権限は不要（Stage 0 で剥奪済）。本ポリシーは
--   authenticated のみを対象とするため、anon 経由の招待検証/受諾フローには影響しない。
--
-- 対象ロール: authenticated（内部管理者のみ SELECT 可）。
--   service_role（管理画面 / api/invites / DEFINER RPC）は RLS をバイパスするため対象外。
--   anon は Stage 0 で権限剥奪済み＋RPC 経由のため対象外。
--
-- 冪等: enable RLS は再実行安全。ポリシーは drop policy if exists → create。
-- 可逆: 末尾のロールバック節参照（disable RLS / drop policy）。破壊的操作なし。
-- =============================================================================

alter table public.invites enable row level security;

-- SELECT: org の内部管理者(owner/admin/member) のみ。トークンを含むため client/vendor
--   および他 org には一切見せない。
drop policy if exists invites_select_internal on public.invites;
create policy invites_select_internal
  on public.invites
  for select
  to authenticated
  using ( public.app_is_org_internal(org_id) );

-- INSERT / UPDATE / DELETE: authenticated 向けポリシーは作らない（＝全拒否）。
--   招待の作成/受諾は SECURITY DEFINER RPC（rpc_create_invite / rpc_accept_invite）
--   および admin(service_role) が RLS バイパスで実施する。

-- =============================================================================
-- 検証（検証ゲート#2 / SPEC 5-2）:
--   1) 内部ユーザー(owner/admin/member) が自 org の invites を SELECT でき、
--      token を含む行が返る。client/vendor ロールは 0 件、他 org も 0 件。
--   2) authenticated からの INSERT/UPDATE/DELETE が全拒否されること（ポリシー0件）。
--   3) anon の招待検証（rpc_validate_invite）と受諾（rpc_accept_invite）が従来通り動作
--      すること（DEFINER 経由のため RLS の影響を受けない）。
--   4) 管理画面 / api/invites（service_role）が従来通り全 invites を操作できること。
--   5) 主要動線スモーク: 招待作成→メール→トークン検証→受諾、管理画面の招待一覧。
--   ドライラン: apply-migration.sh の BEGIN→ROLLBACK で構文/依存を先行検証。
--
-- ロールバック（破綻したら即実行）:
--   drop policy if exists invites_select_internal on public.invites;
--   alter table public.invites disable row level security;
--   ※ RLS 無効化のみでも即時に従来挙動へ戻る。
-- =============================================================================
