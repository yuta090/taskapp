-- =============================================================================
-- auth.users の token 系列の NULL を空文字へ是正する（GoTrue admin API の復旧）
--
-- 背景（本番で実際に壊れていた・2026-07-22 発見）:
--   20260720210220_connector_system_user.sql が `auth.users` へ直接 INSERT する際、
--   confirmation_token / recovery_token / email_change / email_change_token_new を
--   指定しなかったため NULL のまま入った。GoTrue(Go) はこれらを **非NULLの string**
--   としてスキャンするため、1行でも NULL があると
--     `supabase.auth.admin.listUsers()` → "Database error finding users"
--   となり **プロジェクト全体のユーザー一覧が失敗する**（該当ユーザーだけではない）。
--
--   実害: `src/app/admin/(panel)/users/page.tsx`（管理画面のユーザー一覧）と
--        `src/lib/slack/usermap.ts`（Slackユーザー対応付け）が本番で機能停止していた。
--
-- 対処: 全 auth.users の token 系列 NULL を '' に寄せる（空文字＝トークン無し）。
--   元 migration は既に適用済みで再実行されないため、追補としてここで是正する。
--   冪等（NULL が無ければ0行更新）。将来 auth.users へ直接 INSERT する migration を
--   書くときは、これらの列に必ず '' を入れること。
-- =============================================================================

update auth.users
set confirmation_token          = coalesce(confirmation_token, ''),
    recovery_token              = coalesce(recovery_token, ''),
    email_change                = coalesce(email_change, ''),
    email_change_token_new      = coalesce(email_change_token_new, ''),
    email_change_token_current  = coalesce(email_change_token_current, ''),
    phone_change                = coalesce(phone_change, ''),
    phone_change_token          = coalesce(phone_change_token, ''),
    reauthentication_token      = coalesce(reauthentication_token, '')
where confirmation_token is null
   or recovery_token is null
   or email_change is null
   or email_change_token_new is null
   or email_change_token_current is null
   or phone_change is null
   or phone_change_token is null
   or reauthentication_token is null;

-- =============================================================================
-- ロールバック: 不要（NULL へ戻すと GoTrue が再び壊れるため戻さない）。
-- =============================================================================
