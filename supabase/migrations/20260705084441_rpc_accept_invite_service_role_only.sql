-- =============================================================================
-- rpc_accept_invite を service_role 専用に格下げ
-- =============================================================================
-- 受諾経路は POST /api/invites/[token]/accept（サーバーサイド）に一本化された。
-- 20260704161919_rpc_authz_org_invite.sql に記載した残存リスク
-- （anon 経路でトークン保持者が任意 p_user_id を紐付け可能）の恒久対応。
-- クライアントからの直接 RPC 呼出（anon/authenticated とも）は廃止。
-- =============================================================================
revoke execute on function rpc_accept_invite(text, uuid) from public, anon, authenticated;
grant  execute on function rpc_accept_invite(text, uuid) to service_role;
